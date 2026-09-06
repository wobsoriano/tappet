import { defineConfig } from "@playwright/test";
import type { DeviceTestOptions } from "playwright-agent-device";

const shared = {
  app: "dev.pwad.e2e",
  readyWhen: { testId: "home" },
} as const;

export default defineConfig<DeviceTestOptions>({
  // The specs are .mts because agent-device is ESM only and this app is CommonJS.
  testDir: "e2e",
  // The deliberate-failure spec stays out of the default run. Include it with PWAD_INCLUDE_FAILING=1.
  testIgnore: process.env["PWAD_INCLUDE_FAILING"] === "1" ? [] : ["**/failing.spec.mts"],
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 10_000 },
  reporter: [["list"], ["html", { open: "never" }]],
  projects: [
    { name: "ios", use: { device: { ...shared, platform: "ios", name: "iPhone 17 Pro Max" } } },
    { name: "android", use: { device: { ...shared, platform: "android", name: "ci api34" } } },
  ],
});
