import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";

const cwd = fileURLToPath(new URL("..", import.meta.url));
const check = process.argv[2] ?? "verify";
if (!["verify", "test", "test:e2e"].includes(check)) {
  throw new Error("Use verify, test, or test:e2e");
}
const project = `chairly-bew005-${process.pid}`;
const port = process.env.CHAIRLY_TEST_DB_PORT ?? "55435";
const env = {
  ...process.env,
  DATABASE_URL: `postgresql://chairly_app:local-verification-app-only@127.0.0.1:${port}/chairly_verification`,
  MIGRATION_DATABASE_URL: `postgresql://chairly_migrator:local-verification-only@127.0.0.1:${port}/chairly_verification`,
  AUTH_SESSION_SECRET: randomBytes(32).toString("hex"),
  RATE_LIMIT_SECRET: randomBytes(32).toString("hex"),
  NEXT_TELEMETRY_DISABLED: "1",
};
const compose = [
  "compose",
  "--project-name",
  project,
  "-f",
  "compose.verification.yml",
];
function run(command, args) {
  const result = spawnSync(command, args, { cwd, env, stdio: "inherit" });
  if (result.error || result.status !== 0)
    throw new Error(`${command} ${args[0]} failed`);
}
try {
  run("docker", [...compose, "up", "--detach", "--wait"]);
  run("pnpm", ["db:migrate:test"]);
  run("docker", [
    ...compose,
    "exec",
    "-T",
    "postgres",
    "psql",
    "-U",
    "chairly_migrator",
    "-d",
    "chairly_verification",
    "-v",
    "ON_ERROR_STOP=1",
    "-f",
    "/verification/grants.sql",
  ]);
  run("pnpm", [check]);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  const result = spawnSync(
    "docker",
    [...compose, "down", "--volumes", "--remove-orphans"],
    { cwd, env, stdio: "inherit" },
  );
  if (result.error || result.status !== 0) process.exitCode = 1;
}
