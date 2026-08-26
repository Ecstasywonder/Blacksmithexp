import { defineConfig, devices } from "@playwright/test";
import { resolve } from "node:path";

const port = 3210;
const webAppDirectory = resolve(__dirname, "../../apps/web");
const localBrowser =
  process.platform === "win32" ? { channel: "msedge" as const } : {};

export default defineConfig({
  testDir: ".",
  testMatch: "**/*.spec.ts",
  fullyParallel: true,
  timeout: 90_000,
  retries: process.env.CI ? 2 : 0,
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
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    url: `http://127.0.0.1:${port}/api/health`,
  },
});
