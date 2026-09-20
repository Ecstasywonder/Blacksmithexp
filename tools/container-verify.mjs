import { spawnSync } from "node:child_process";

for (const name of [
  "DATABASE_URL",
  "MIGRATION_DATABASE_URL",
  "CHAIRLY_E2E_BASE_URL",
  "AUTH_SESSION_SECRET",
]) {
  if (!process.env[name])
    throw new Error(`${name} is required for container verification`);
}

const checks = [
  "format:check",
  "lint",
  "typecheck",
  "db:migrate:test",
  "test",
  "test:e2e",
  "build",
];
const failures = [];
for (const check of checks) {
  console.log(`[verification] running ${check}`);
  const result = spawnSync("pnpm", [check], {
    stdio: "inherit",
    env: process.env,
  });
  if (result.error || result.status !== 0) failures.push(check);
}
console.log(
  `[verification] ${failures.length ? `FAILED: ${failures.join(", ")}` : "all checks passed"}`,
);
process.exitCode = failures.length ? 1 : 0;
