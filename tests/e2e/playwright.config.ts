import { defineConfig, devices } from "@playwright/test";
import { resolve } from "node:path";

for (const name of [
  "DATABASE_URL",
  "MIGRATION_DATABASE_URL",
  "AUTH_SESSION_SECRET",
  "RATE_LIMIT_SECRET",
]) {
  if (!process.env[name])
    throw new Error(
      `${name} is required for database-backed booking verification`,
    );
}
if (
  process.env.CHAIRLY_E2E_CATALOG ||
  process.env.CHAIRLY_E2E_PRODUCTION_BUILD
) {
  throw new Error(
    "Booking guarantees must run against PostgreSQL, with synthetic adapters disabled",
  );
}
const port = Number(process.env.CHAIRLY_E2E_PORT ?? 3215);
export default defineConfig({
  testDir: ".",
  testMatch: "booking-guarantees.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: true,
  timeout: 60_000,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `pnpm build && pnpm start --hostname 127.0.0.1 --port ${port}`,
    cwd: resolve(__dirname, "../../apps/web"),
    reuseExistingServer: false,
    timeout: 300_000,
    url: `http://127.0.0.1:${port}/api/health`,
    env: { NEXT_TELEMETRY_DISABLED: "1" },
  },
});
