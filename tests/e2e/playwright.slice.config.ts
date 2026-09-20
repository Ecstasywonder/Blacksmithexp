import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "booking-slice.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 45_000,
  globalTimeout: 240_000,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:3310",
    ...devices["Desktop Chrome"],
    // No traces: they can capture customer details and authentication tokens.
    trace: "off",
    screenshot: "off",
  },
});
