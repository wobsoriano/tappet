import { expect, test } from 'vite-plus/test';
import type { DeviceOptions } from '../src/core/config.ts';
import { TappetError } from '../src/core/errors.ts';
import { preflight } from '../src/preflight.ts';
import { createFakeDriver } from './fake-driver.ts';

const options: DeviceOptions = {
  platform: 'ios',
  app: 'com.wobsoriano.awesometodo',
  readyWhen: { text: 'GET STARTED' },
};

test('an unset device name passes on whatever is booted, and names the one it found', async () => {
  const driver = createFakeDriver();
  const report = await preflight(options, driver);
  expect(report).toEqual({
    ok: true,
    device: { name: 'iPhone 17 Pro Max', id: '2A141E2F-5FD1-4F16-86FB-E9A5835F2166' },
  });
});

test('a named device that is booted passes', async () => {
  const driver = createFakeDriver();
  const report = await preflight({ ...options, name: 'iPhone 17 Pro Max' }, driver);
  expect(report.ok).toBe(true);
  if (!report.ok) return;
  expect(report.device.name).toBe('iPhone 17 Pro Max');
});

test('a named device that is not booted names it, what is booted, and the way out', async () => {
  const driver = createFakeDriver();
  driver.devices.push({ id: 'B2', name: 'iPad Pro 13-inch', booted: true });
  const report = await preflight({ ...options, name: 'iPhone 16' }, driver);
  expect(report.ok).toBe(false);
  if (report.ok) return;
  expect(report.problems).toEqual([
    "No booted ios device is named 'iPhone 16'. Booted right now: 'iPhone 17 Pro Max', 'iPad Pro 13-inch'. Set use.device.name to one of those or boot 'iPhone 16'.",
  ]);
});

test('nothing booted at all says so, and says how to boot one', async () => {
  const driver = createFakeDriver();
  driver.devices = [{ id: 'A1', name: 'iPhone 17 Pro Max', booted: false }];
  expect(await preflight(options, driver)).toEqual({
    ok: false,
    problems: ['No ios device is booted. Boot one with `agent-device device boot --platform ios`.'],
  });
  expect(await preflight({ ...options, name: 'iPhone 17 Pro Max' }, driver)).toEqual({
    ok: false,
    problems: [
      "No booted ios device is named 'iPhone 17 Pro Max', because no ios device is booted at all. Boot 'iPhone 17 Pro Max'.",
    ],
  });
});

test('a pool reports one problem per missing name and passes on the first', async () => {
  const driver = createFakeDriver();
  const missing = await preflight({ ...options, name: ['one', 'two'] }, driver);
  expect(missing.ok).toBe(false);
  if (missing.ok) return;
  expect(missing.problems.length).toBe(2);
  expect(missing.problems[0]).toContain("is named 'one'");
  expect(missing.problems[1]).toContain("is named 'two'");

  driver.devices = [
    { id: 'A1', name: 'one', booted: true },
    { id: 'A2', name: 'two', booted: true },
  ];
  expect(await preflight({ ...options, name: ['one', 'two'] }, driver)).toEqual({
    ok: true,
    device: { name: 'one', id: 'A1' },
  });
});

test('a driver that cannot list reports the failure and points at the daemon', async () => {
  const driver = {
    ...createFakeDriver(),
    listDevices: () =>
      Promise.reject(
        new TappetError({
          kind: 'driver',
          command: 'listDevices',
          failure: { kind: 'device-missing', detail: 'daemon not running' },
        }),
      ),
  };
  expect(await preflight(options, driver)).toEqual({
    ok: false,
    problems: [
      'Could not list ios devices: no matching device is booted (daemon not running). Check that the agent-device daemon is reachable.',
    ],
  });
});

test('a malformed config throws rather than reporting a problem', async () => {
  const driver = createFakeDriver();
  await expect(preflight({ ...options, app: '' }, driver)).rejects.toThrow(/device\.app/);
});
