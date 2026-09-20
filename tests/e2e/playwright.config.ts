import { defineConfig, devices } from "@playwright/test";
import { resolve } from "node:path";

const port = 3210;
const webAppDirectory = resolve(__dirname, "../../apps/web");
const externalBaseUrl = process.env.CHAIRLY_E2E_BASE_URL;
const localBrowser =
  process.platform === "win32" ? { channel: "msedge" as const } : {};

export default defineConfig({
  testDir: ".",
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  use: {
    baseURL: externalBaseUrl ?? `http://127.0.0.1:${port}`,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], ...localBrowser },
    },
  ],
  webServer: externalBaseUrl
    ? undefined
    : {
        command: `pnpm start --hostname 127.0.0.1 --port ${port}`,
        cwd: webAppDirectory,
        env: {
          DATABASE_URL: process.env.DATABASE_URL ?? "",
          AUTH_SESSION_SECRET:
            process.env.AUTH_SESSION_SECRET ??
            "chairly-local-booking-slice-secret",
        },
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
        url: `http://127.0.0.1:${port}/api/health`,
      },
});
