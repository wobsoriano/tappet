import { test as base } from '@playwright/test';
import { preflight, type DeviceTestOptions } from 'tappet';
import { UNCONFIGURED_DEVICE } from 'tappet/core';

// Extends `@playwright/test`'s own `test` rather than tappet's. Tappet's `app` fixture is auto and
// would open a session, which is the very thing preflight runs before.
const setup = base.extend<object, DeviceTestOptions>({
  device: [UNCONFIGURED_DEVICE, { option: true, scope: 'worker' }],
});

setup('the project names a booted device', async ({ device }) => {
  const report = await preflight(device);
  if (report.ok) return;
  throw new Error(report.problems.join('\n'));
});
