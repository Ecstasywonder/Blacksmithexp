import { spawn } from "node:child_process";
import { performance } from "node:perf_hooks";
import { resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "..");
const composeFile = resolve(repoRoot, "compose.booking-slice.yml");
const runtimeEnvironment = {
  ...process.env,
  DATABASE_URL:
    process.env.DATABASE_URL ??
    "postgresql://chairly_app:chairly_app@127.0.0.1:55432/chairly",
  MIGRATION_DATABASE_URL:
    process.env.MIGRATION_DATABASE_URL ??
    "postgresql://chairly_migrator:chairly_migrator@127.0.0.1:55432/chairly",
  AUTH_SESSION_SECRET:
    process.env.AUTH_SESSION_SECRET ?? "chairly-local-booking-slice-secret",
  APP_ORIGIN: process.env.APP_ORIGIN ?? "http://127.0.0.1:3210",
  CHAIRLY_DATABASE_RUNTIME_ROLE:
    process.env.CHAIRLY_DATABASE_RUNTIME_ROLE ?? "chairly_app",
};

function formatDuration(durationMs) {
  return `${(durationMs / 1000).toFixed(2)}s`;
}

function runCommand(command, args, options = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    const startedAt = performance.now();
    const child = spawn(command, args, {
      cwd: repoRoot,
      env: runtimeEnvironment,
      stdio: "inherit",
      ...options,
    });

    child.on("error", rejectPromise);
    child.on("exit", (code) => {
      const durationMs = performance.now() - startedAt;
      if (code === 0) {
        resolvePromise({ code, durationMs });
        return;
      }

      rejectPromise(
        new Error(
          `${command} ${args.join(" ")} exited with code ${code ?? "null"}`,
        ),
      );
    });
  });
}

async function setupSlice() {
  const startedAt = performance.now();
  await runCommand("docker", [
    "compose",
    "-f",
    composeFile,
    "up",
    "-d",
    "--wait",
  ]);
  await runCommand("pnpm", ["db:migrate"]);
  await runCommand("pnpm", [
    "--filter",
    "@chairly/database",
    "booking-slice:reset",
  ]);
  const durationMs = performance.now() - startedAt;
  console.log(
    `[booking-slice] setup completed in ${formatDuration(durationMs)}`,
  );
  return durationMs;
}

async function verifySlice() {
  const startedAt = performance.now();
  await runCommand("pnpm", ["--filter", "@chairly/database", "test"]);
  await runCommand("pnpm", ["test:e2e"]);
  const durationMs = performance.now() - startedAt;
  console.log(
    `[booking-slice] verification completed in ${formatDuration(durationMs)}`,
  );
  return durationMs;
}

async function teardownSlice() {
  await runCommand("docker", [
    "compose",
    "-f",
    composeFile,
    "down",
    "--volumes",
    "--remove-orphans",
  ]);
}

async function main() {
  const subcommand = process.argv[2] ?? "check";

  if (subcommand === "setup") {
    await setupSlice();
    return;
  }

  if (subcommand === "verify") {
    await verifySlice();
    return;
  }

  if (subcommand === "teardown") {
    await teardownSlice();
    return;
  }

  if (subcommand === "check") {
    const startedAt = performance.now();
    const setupDurationMs = await setupSlice();
    const verificationDurationMs = await verifySlice();
    const totalDurationMs = performance.now() - startedAt;
    console.log(
      `[booking-slice] total completed in ${formatDuration(totalDurationMs)}`,
    );
    console.log(
      `[booking-slice] summary setup=${formatDuration(setupDurationMs)} verify=${formatDuration(verificationDurationMs)}`,
    );
    return;
  }

  throw new Error(
    `Unknown booking-slice command "${subcommand}". Use setup, verify, teardown, or check.`,
  );
}

await main();
