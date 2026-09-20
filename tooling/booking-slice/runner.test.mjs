import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  symlinkSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const runner = fileURLToPath(new URL("./run.sh", import.meta.url));
function run(mode, action = "up") {
  const directory = mkdtempSync(join(tmpdir(), "booking-runner-"));
  try {
    const bin = join(directory, "bin");
    mkdirSync(bin);
    for (const command of ["dirname", "sleep"]) {
      const executable = spawnSync("/bin/sh", ["-c", `command -v ${command}`], {
        encoding: "utf8",
      }).stdout.trim();
      symlinkSync(executable, join(bin, command));
    }
    if (mode !== "missing") {
      writeFileSync(
        join(bin, "docker"),
        `#!/bin/bash
printf '%s\\n' "$*" >> "$CALLS"
case "$MODE:$*" in
  daemon:info) echo 'Docker engine unavailable' >&2; exit 42 ;;
  hang:info) exec sleep 60 ;;
  build:*build) echo 'Image download failed' >&2; exit 23 ;;
  readiness:*up*) echo 'Database unhealthy' >&2; exit 17 ;;
  migration:*db:migrate:test*) echo 'Migration failed' >&2; exit 21 ;;
  tests:*playwright.slice.config.ts*) echo 'Tenant isolation assertion failed' >&2; exit 19 ;;
esac
exit 0
`,
        { mode: 0o755 },
      );
    }
    const started = Date.now();
    const result = spawnSync("/bin/bash", [runner, action], {
      env: { PATH: bin, MODE: mode, CALLS: join(directory, "calls") },
      encoding: "utf8",
      timeout: 25_000,
    });
    assert.ifError(result.error);
    return {
      status: result.status,
      output: result.stdout + result.stderr,
      elapsed: Date.now() - started,
      calls:
        mode === "missing" || action === "invalid"
          ? ""
          : readFileSync(join(directory, "calls"), "utf8"),
    };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

for (const [mode, message] of [
  ["missing", "Docker is missing"],
  ["daemon", "checking Docker engine access"],
  ["build", "building the app"],
  ["readiness", "starting PostgreSQL"],
  ["migration", "applying migrations again"],
  ["tests", "four real booking browser scenarios"],
]) {
  test(`runner reports ${mode} failure without claiming success`, () => {
    const result = run(mode);
    assert.notEqual(result.status, 0);
    assert.match(result.output, /Booking slice FAILED/);
    assert.ok(result.output.includes(message), result.output);
    assert.doesNotMatch(result.output, /Booking slice PASSED/);
    assert.ok(
      result.elapsed < 5000,
      "watchdog must not leave output pipes open",
    );
  });
}

test("runner bounds an unresponsive Docker daemon", () => {
  const result = run("hang");
  assert.notEqual(result.status, 0);
  assert.match(result.output, /timed out after 15 seconds/);
  assert.match(result.output, /Booking slice FAILED/);
  assert.doesNotMatch(result.output, /Booking slice PASSED/);
});

test("runner rejects unknown commands before contacting Docker", () => {
  const result = run("missing", "invalid");
  assert.equal(result.status, 2);
  assert.match(result.output, /Usage:/);
});

test("runner removes only the slice and its volumes", () => {
  const result = run("success", "down");
  assert.equal(result.status, 0, result.output);
  assert.match(
    result.calls,
    /-p chairly-booking-slice -f compose.booking-slice.yml down --volumes --remove-orphans/,
  );
  assert.doesNotMatch(result.calls, /prune/);
});

test("runner success requires migrations, checks, reset, and both browser suites", () => {
  const result = run("success");
  assert.equal(result.status, 0, result.output);
  for (const command of [
    "build",
    "up -d --wait",
    "db:migrate:test",
    "format:check",
    "lint",
    "typecheck",
    "pnpm test",
    "--reset-appointments",
    "playwright.slice.config.ts",
    "test:e2e",
  ]) {
    assert.ok(result.calls.includes(command), command);
  }
  assert.match(result.output, /Booking slice PASSED/);
});
