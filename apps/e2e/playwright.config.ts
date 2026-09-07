import { defineConfig } from '@playwright/test';
import type { TappetOptions } from 'tappet';

// The device names are overridable because CI boots whatever model its runner image carries, which
// is not the one on a developer's machine. Preflight turns a mismatch into one readable failure.
const ios = {
  platform: 'ios',
  deviceName: process.env['TAPPET_IOS_DEVICE'] ?? 'iPhone 17 Pro Max',
} as const;
const android = {
  platform: 'android',
  deviceName: process.env['TAPPET_ANDROID_DEVICE'] ?? 'Expo API 36',
} as const;

export default defineConfig<TappetOptions>({
  // The specs are .mts because Playwright transpiles the workspace-linked library as source, and
  // that CommonJS output cannot require agent-device. A published install keeps plain .ts specs.
  testDir: 'e2e',
  // The deliberate-failure spec stays out of the default run. Include it with TAPPET_INCLUDE_FAILING=1.
  testIgnore: process.env['TAPPET_INCLUDE_FAILING'] === '1' ? [] : ['**/failing.spec.mts'],
  workers: 1,
  // One retry in CI. A shared runner is slow enough that a device-side race can lose a keystroke,
  // and Playwright replaces the worker on a failure, which is the path the session lifecycle is
  // built for. The replacement reuses the same slot, so it reclaims the same device and session.
  retries: process.env['CI'] ? 1 : 0,
  timeout: 120_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    app: 'dev.tappet.e2e',
    readyWhen: { testId: 'home' },
  },
  projects: [
    // One setup project per platform, off the same spec. A Playwright setup project has a single
    // `use`, so a shared one could only ever check one platform's device, and running the other
    // platform would gate on a device that run has no reason to have booted.
    { name: 'setup-ios', testMatch: /preflight\.setup\.mts/, use: ios },
    { name: 'setup-android', testMatch: /preflight\.setup\.mts/, use: android },
    { name: 'ios', dependencies: ['setup-ios'], use: ios },
    { name: 'android', dependencies: ['setup-android'], use: android },
  ],
});
