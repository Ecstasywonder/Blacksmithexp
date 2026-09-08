import { defineConfig, devices } from "@playwright/test";
import { resolve } from "node:path";

const port = 3210;
const webAppDirectory = resolve(__dirname, "../../apps/web");
const localBrowser =
  process.platform === "win32" || process.env.CHAIRLY_E2E_CHANNEL === "msedge"
    ? { channel: "msedge" as const }
    : {};

export default defineConfig({
  testDir: ".",
  testMatch: ["booking-form.spec.ts", "pending-appointments.spec.ts"],
  fullyParallel: false,
  workers: 1,
  forbidOnly: true,
  timeout: 90_000,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], ...localBrowser },
    },
  ],
  webServer: {
    command: `pnpm build && pnpm start --hostname 127.0.0.1 --port ${port}`,
    cwd: webAppDirectory,
    env: {
      CHAIRLY_E2E_CATALOG: "synthetic",
      CHAIRLY_E2E_PRODUCTION_BUILD: "true",
    },
    reuseExistingServer: false,
    timeout: 300_000,
    url: `http://127.0.0.1:${port}/api/health`,
  },
});
