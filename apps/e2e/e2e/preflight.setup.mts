import { preflight, setupTest } from 'tangere';

// `setupTest` carries tangere's options and none of its fixtures. Tangere's `test` would open a
// device session through its auto `device` fixture, before preflight has checked the device.
setupTest(
  'the project names a booted device',
  async ({ platform, app, readyWhen, deviceName, sessionPrefix }) => {
    const report = await preflight({ platform, app, readyWhen, deviceName, sessionPrefix });
    if (report.ok) return;
    throw new Error(report.problems.join('\n'));
  },
);
