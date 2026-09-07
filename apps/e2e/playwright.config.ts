import { defineConfig } from '@playwright/test';
import type { DeviceTestOptions } from 'tappet';

const shared = {
  app: 'dev.tappet.e2e',
  readyWhen: { testId: 'home' },
} as const;

// The device names are overridable because CI boots whatever model its runner image carries, which
// is not the one on a developer's machine. Preflight turns a mismatch into one readable failure.
const ios = {
  ...shared,
  platform: 'ios',
  name: process.env['TAPPET_IOS_DEVICE'] ?? 'iPhone 17 Pro Max',
} as const;
const android = {
  ...shared,
  platform: 'android',
  name: process.env['TAPPET_ANDROID_DEVICE'] ?? 'Expo API 36',
} as const;

export default defineConfig<DeviceTestOptions>({
  // The specs are .mts because Playwright transpiles the workspace-linked library as source, and
  // that CommonJS output cannot require agent-device. A published install keeps plain .ts specs.
  testDir: 'e2e',
  // The deliberate-failure spec stays out of the default run. Include it with TAPPET_INCLUDE_FAILING=1.
  testIgnore: process.env['TAPPET_INCLUDE_FAILING'] === '1' ? [] : ['**/failing.spec.mts'],
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  projects: [
    // One setup project per platform, off the same spec. A Playwright setup project has a single
    // `use`, so a shared one could only ever check one platform's device, and running the other
    // platform would gate on a device that run has no reason to have booted.
    { name: 'setup-ios', testMatch: /preflight\.setup\.mts/, use: { device: ios } },
    { name: 'setup-android', testMatch: /preflight\.setup\.mts/, use: { device: android } },
    { name: 'ios', dependencies: ['setup-ios'], use: { device: ios } },
    { name: 'android', dependencies: ['setup-android'], use: { device: android } },
  ],
});
