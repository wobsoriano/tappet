import { preflight, setupTest } from 'tappet';

// `setupTest` carries tappet's options and none of its fixtures. Tappet's `test` would open a
// session through its auto `device` fixture, which is the very thing preflight runs ahead of.
setupTest(
  'the project names a booted device',
  async ({ platform, app, readyWhen, deviceName, sessionPrefix }) => {
    const report = await preflight({ platform, app, readyWhen, deviceName, sessionPrefix });
    if (report.ok) return;
    throw new Error(report.problems.join('\n'));
  },
);
