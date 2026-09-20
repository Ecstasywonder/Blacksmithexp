import { spawn, spawnSync } from "node:child_process";

for (const [label, args] of [
  ["database migrations", ["db:migrate"]],
  [
    "minimal booking fixtures and runtime grants",
    [
      "--filter",
      "@chairly/database",
      "exec",
      "tsx",
      "src/booking-slice-seed.ts",
    ],
  ],
]) {
  console.log(`Booking slice: ${label}`);
  const result = spawnSync("pnpm", args, { stdio: "inherit", timeout: 60_000 });
  if (result.status !== 0) {
    console.error(
      `Booking slice failed during ${label}. Run docker compose -f compose.booking-slice.yml logs slice; then follow the reset steps in README.md.`,
    );
    process.exit(1);
  }
}
const children = [
  spawn(
    "pnpm",
    [
      "--filter",
      "@chairly/web",
      "start",
      "--hostname",
      "127.0.0.1",
      "--port",
      "3211",
    ],
    { stdio: "inherit" },
  ),
  spawn("node", ["tooling/booking-slice/gateway.mjs"], { stdio: "inherit" }),
];
let stopping = false;
function stop(code) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill("SIGTERM");
  process.exitCode = code;
}
for (const child of children) {
  child.on("error", () => {
    console.error("Booking slice could not start a required process.");
    stop(1);
  });
  child.on("exit", () => {
    if (!stopping) {
      console.error(
        "Booking slice: a required process stopped. Inspect the slice logs.",
      );
      stop(1);
    }
  });
}
process.on("SIGTERM", () => stop(0));
process.on("SIGINT", () => stop(0));
