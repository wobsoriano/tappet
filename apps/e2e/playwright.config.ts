import { defineConfig } from '@playwright/test';
import type { DeviceTestOptions } from 'tappet';

const shared = {
  app: 'dev.tappet.e2e',
  readyWhen: { testId: 'home' },
} as const;

const ios = { ...shared, platform: 'ios', name: 'iPhone 17 Pro Max' } as const;
const android = { ...shared, platform: 'android', name: 'ci api34' } as const;

export default defineConfig<DeviceTestOptions>({
  // The specs are .mts because agent-device is ESM only and this app is CommonJS.
  testDir: 'e2e',
  // The deliberate-failure spec stays out of the default run. Include it with TAPPET_INCLUDE_FAILING=1.
  testIgnore: process.env['TAPPET_INCLUDE_FAILING'] === '1' ? [] : ['**/failing.spec.mts'],
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  projects: [
    // The setup project carries its own device because a Playwright setup project has one `use`,
    // and this workspace only runs the iOS project.
    { name: 'setup', testMatch: /preflight\.setup\.mts/, use: { device: ios } },
    { name: 'ios', dependencies: ['setup'], use: { device: ios } },
    { name: 'android', dependencies: ['setup'], use: { device: android } },
  ],
});
