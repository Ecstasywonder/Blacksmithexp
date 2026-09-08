import { spawnSync } from "node:child_process";

for (const name of [
  "DATABASE_URL",
  "MIGRATION_DATABASE_URL",
  "AUTH_SESSION_SECRET",
  "RATE_LIMIT_SECRET",
]) {
  if (!process.env[name])
    throw new Error(
      `${name} is required; use pnpm verify:local for a disposable PostgreSQL database`,
    );
}
if (
  process.env.CHAIRLY_E2E_CATALOG ||
  process.env.CHAIRLY_E2E_PRODUCTION_BUILD
) {
  throw new Error(
    "Standard verification cannot use synthetic booking adapters",
  );
}
for (const check of [
  "format:check",
  "lint",
  "typecheck",
  "db:migrate:test",
  "test",
  "test:e2e",
  "build",
]) {
  console.log(`[verification] ${check}`);
  const result = spawnSync("pnpm", [check], {
    stdio: "inherit",
    env: process.env,
  });
  if (result.error || result.status !== 0) {
    console.error(`[verification] FAILED: ${check}`);
    process.exit(result.status || 1);
  }
}
console.log("[verification] all checks passed");
