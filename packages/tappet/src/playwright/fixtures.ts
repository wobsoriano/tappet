import { test as base, type TestInfo } from '@playwright/test';
import { createApp, type App } from '../core/app.ts';
import { parseDeviceOptions, UNCONFIGURED_DEVICE, type DeviceOptions } from '../core/config.ts';
import { captureEvidence } from '../core/evidence.ts';
import { silentSink, type ActionSink, type EvidenceFile } from '../core/report.ts';
import { openSession, type DeviceSession } from '../core/session.ts';
import { createAgentDeviceDriver, createClient } from '../driver/agent-device.ts';

const SESSION_FIXTURE_TIMEOUT_MS = 180_000;
// The per-test relaunch and the evidence capture run in this fixture, not in the test body, so it
// needs a budget of its own. Charged to the test timeout, a slow relaunch reads as a test timeout
// instead of the launch failure it is.
const APP_FIXTURE_TIMEOUT_MS = 120_000;

/** What `defineConfig<DeviceTestOptions>` types inside `use`. One key. */
export type DeviceTestOptions = {
  device: DeviceOptions;
};

export type DeviceWorkerFixtures = DeviceTestOptions & {
  session: DeviceSession;
};

export type DeviceTestFixtures = {
  app: App;
};

/**
 * The worker session opened the app with a relaunch already, so the first test
 * in a worker does not need another one.
 */
const startedTests = new WeakSet<DeviceSession>();

/**
 * Fixture graph: `device` (worker option, from `use`) feeds `session` (worker),
 * which feeds `app` (test, auto).
 *
 * `app` is auto so evidence capture runs for every test in a device project,
 * whether or not the body touched it. Its teardown runs before the session's,
 * inside the separate budget Playwright grants after the test finishes, so a
 * timed-out test still gets a screenshot.
 *
 * Importing and extending `test` launches no browser: `browser`, `context`,
 * and `page` are lazy and non-auto, and nothing here names them.
 */
export const test = base.extend<DeviceTestFixtures, DeviceWorkerFixtures>({
  device: [UNCONFIGURED_DEVICE, { option: true, scope: 'worker' }],

  session: [
    async ({ device }, use, workerInfo) => {
      const options = parseDeviceOptions(device);
      const session = await openSession({
        options,
        // `parallelIndex` and not `workerIndex`: Playwright discards a worker after any failure and
        // the replacement reuses the same slot, so this is what makes a retry reuse the same device
        // and reconnect to the same daemon session instead of stranding it.
        slot: workerInfo.parallelIndex,
        scope: workerInfo.project.name,
        sink: playwrightSink(),
        createDriver: (name, selection) => createAgentDeviceDriver(createClient(), name, selection),
      });
      await use(session);
      await session.close('worker-exit');
    },
    { scope: 'worker', timeout: SESSION_FIXTURE_TIMEOUT_MS },
  ],

  app: [
    async ({ session }, use, testInfo) => {
      const sink = playwrightSink();
      if (session.options.relaunch === 'per-test' && startedTests.has(session)) {
        await session.relaunch(sink);
      }
      startedTests.add(session);

      await use(createApp(session, sink));

      if (shouldCapture(testInfo, session.options.evidence)) await captureEvidence(session, sink);
    },
    { auto: true, timeout: APP_FIXTURE_TIMEOUT_MS },
  ],
});

function shouldCapture(testInfo: TestInfo, evidence: 'on-failure' | 'always' | 'off'): boolean {
  if (evidence === 'off') return false;
  return evidence === 'always' || testInfo.status !== testInfo.expectedStatus;
}

/**
 * Resolves the running test on every call rather than capturing a `TestInfo`.
 * A worker outlives every test in it, so a captured one would file the second
 * test's evidence under the first test's report entry.
 */
export function playwrightSink(): ActionSink {
  return {
    step: (title, body) => base.step(title, body),
    attach: async (file: EvidenceFile) => {
      const info = currentTest();
      if (info === null) return;
      await info.attach(
        file.name,
        'path' in file
          ? { path: file.path, contentType: file.contentType }
          : { body: file.body, contentType: file.contentType },
      );
    },
    note: (key, value) => {
      currentTest()?.annotations.push({ type: key, description: value });
    },
    outputPath: (fileName) =>
      currentTest()?.outputPath(fileName) ?? silentSink.outputPath(fileName),
  };
}

function currentTest(): TestInfo | null {
  try {
    return base.info();
  } catch {
    // `test.info()` throws outside test execution, which is not a reason to fail a device command.
    return null;
  }
}
