import { spawnSync } from "node:child_process";

function run(args) {
  const result = spawnSync("pnpm", args, { stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

// An external test app already has a production build running in Docker.
if (!process.env.CHAIRLY_E2E_BASE_URL) {
  run(["--filter", "@chairly/web", "build"]);
}
run(["exec", "playwright", "test", ...process.argv.slice(2)]);
