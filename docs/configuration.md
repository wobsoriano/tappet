# Configuration

Everything tappet reads lives under one key, `use.device`. It is parsed once at worker start and nothing downstream validates it again, so a mistake fails immediately and names the field to fix.

```ts
// playwright.config.ts
import { defineConfig } from '@playwright/test';
import type { DeviceTestOptions } from 'tappet';

const shared = {
  app: 'com.example.app',
  readyWhen: { testId: 'home' },
} as const;

const ios = { ...shared, platform: 'ios', name: 'iPhone 17 Pro Max' } as const;
const android = { ...shared, platform: 'android', name: 'ci api34' } as const;

export default defineConfig<DeviceTestOptions>({
  testDir: 'e2e',
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  projects: [
    { name: 'setup', testMatch: /preflight\.setup\.mts/, use: { device: ios } },
    { name: 'ios', dependencies: ['setup'], use: { device: ios } },
    { name: 'android', dependencies: ['setup'], use: { device: android } },
  ],
});
```

## The `use` merge caveat

Playwright merges `use` one key at a time. `device` is a single object, so a project that sets it replaces the whole thing rather than merging field by field. Spread a shared constant, as above. Setting `readyWhen` at the top level and `platform` inside a project does not combine them. The project wins outright and the top-level `readyWhen` is gone.

## Options

| field               | default        | meaning                                                                                 |
| ------------------- | -------------- | --------------------------------------------------------------------------------------- |
| `platform`          | required       | `'ios'` or `'android'`                                                                  |
| `app`               | required       | bundle id or package name, never a path to an artifact                                  |
| `readyWhen`         | required       | the locator that means the bundle loaded. `{ text }`, `{ testId }`, or `{ role, name }` |
| `name`              | first booted   | device name. An array is a pool indexed by Playwright's `parallelIndex`                 |
| `relaunch`          | `'per-test'`   | or `'per-worker'`                                                                       |
| `onDeviceInUse`     | `'fail'`       | or `'reclaim'`. Leftovers carrying tappet's own prefix are always reclaimed             |
| `actionTimeout`     | `10_000`       | how long one action waits for its target, settle included                               |
| `settleQuietMs`     | `500`          | the quiet window that ends the post-action settle                                       |
| `launchTimeout`     | `90_000`       | budget for the launch plus the ready gate                                               |
| `dismissDevOverlay` | `false`        | send `react-native dismiss-overlay` after every launch                                  |
| `evidence`          | `'on-failure'` | `'always'` or `'off'`                                                                   |
| `sessionPrefix`     | `'tappet'`     | session names are `${prefix}-${project}-${parallelIndex}`                               |

## `readyWhen` is required

The driver returns from a launch as soon as the native process starts. The JavaScript bundle is still loading at that point, so the first assertion of the first test would race it. `readyWhen` names something that only appears once the bundle has rendered, and tappet holds until it resolves.

Ambiguity is still ready. The gate asks whether the bundle loaded, not whether a locator is unique.

## One device per worker

`name` as a string, or `name` omitted, serves worker slot 0 only. Two workers pointed at one device would both try to claim it, and because leftovers carrying tappet's own prefix are always reclaimed, the second worker would close the first worker's live session mid-test. That is a configuration error rather than a race, and it fails at worker start.

To run more than one worker, give `name` an array with one entry per worker.

```ts
use: { device: { ...shared, platform: 'ios', name: ['iPhone 17 Pro', 'iPhone 17 Pro Max'] } }
```

## Timeouts

`expect.timeout` is what every matcher uses unless the call passes its own `{ timeout }`. `timeout` is Playwright's per-test budget, and it needs room for a relaunch plus a ready gate on every test after the first. `launchTimeout` covers only the launch and the gate, and it is charged to tappet's own fixtures rather than to the test, so a slow launch reads as a launch failure rather than a test timeout.
