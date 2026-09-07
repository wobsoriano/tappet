# tappet

> [!WARNING]
> tappet is highly experimental. Use at your own risk.

tappet runs e2e tests for mobile apps on the Playwright test runner. It drives a booted simulator or emulator through Callstack [`agent-device`](https://agent-device.dev/).

```ts
import { expect, test } from 'tappet';

test('the right credentials land on the profile', async ({ app }) => {
  await app.getByTestId('sign-in-link').tap();
  await app.getByRole('text-field', { name: 'Email' }).fill('rob@example.com');
  await app.getByTestId('password').fill('hunter2');
  await app.getByRole('button', { name: 'Sign in' }).tap();

  await expect(app.getByTestId('signing-in')).toBeVisible();
  await expect(app.getByTestId('profile-email')).toHaveText('rob@example.com', { exact: true });
});
```

## Usage

### Install

```sh
pnpm add -D tappet @playwright/test
```

### Configure

```ts
// playwright.config.ts
import { defineConfig } from '@playwright/test';
import type { DeviceTestOptions } from 'tappet';

const shared = {
  app: 'com.example.app',
  readyWhen: { testId: 'home' },
} as const;

export default defineConfig<DeviceTestOptions>({
  testDir: 'e2e',
  workers: 1,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  projects: [
    { name: 'ios', use: { device: { ...shared, platform: 'ios', name: 'iPhone 17 Pro Max' } } },
    {
      name: 'android',
      use: { device: { ...shared, platform: 'android', name: 'Pixel 7 API 34' } },
    },
  ],
});
```

`device` is the only key tappet adds to `use`. Playwright merges `use` one key at a time, so a project that sets `device` replaces the whole object. Spread a shared constant, as above.

`readyWhen` is required. The driver returns from a launch as soon as the native process starts, before the JavaScript bundle has loaded, so tappet waits for that locator before the first test runs.

`name` is what `agent-device devices` prints, which for an Android emulator is the AVD name with its underscores shown as spaces. An AVD created as `Pixel_7_API_34` is `Pixel 7 API 34` here.

One worker gets one device. To run more than one, give `name` an array with an entry per worker.

### Run

```sh
npx playwright test --project=ios
```

`preflight` reads a project's `device` option and reports whether that device is booted, so a missing simulator fails once, in about a second, instead of once per test after the launch timeout. Wire it as a setup project per platform that the device projects depend on. [Basics](https://github.com/wobsoriano/tappet/blob/main/docs/basics.md) has the spec, and [`apps/e2e/e2e/preflight.setup.mts`](https://github.com/wobsoriano/tappet/blob/main/apps/e2e/e2e/preflight.setup.mts) is a working one.

## Run the sample project

`apps/e2e` is an Expo app with a home, login, and profile route and a fake sign-in. It is the app tappet is tested against. Build the library first with `vp run -r build` so the app can resolve `dist`, then run these from `apps/e2e`:

```sh
npx expo run:ios --device 'iPhone 17 Pro Max' --no-bundler
npx expo start --port 8081
npx playwright test --project=ios
```

Android works the same way. `expo run:android` takes the AVD's own name with underscores, not the spaced name the test config uses, and the emulator needs `adb reverse` to reach Metro on the host.

```sh
npx expo run:android --device Expo_API_36 --no-bundler
adb reverse tcp:8081 tcp:8081
npx expo start --port 8081
npx playwright test --project=android
```

Leave Metro running for the whole suite. The first build takes several minutes.

## Docs

- [Basics](https://github.com/wobsoriano/tappet/blob/main/docs/basics.md)
- [Configuration](https://github.com/wobsoriano/tappet/blob/main/docs/configuration.md)
- [Locators](https://github.com/wobsoriano/tappet/blob/main/docs/locators.md)
- [Assertions](https://github.com/wobsoriano/tappet/blob/main/docs/assertions.md)
- [Lifecycle](https://github.com/wobsoriano/tappet/blob/main/docs/lifecycle.md)
- [Continuous integration](https://github.com/wobsoriano/tappet/blob/main/docs/ci.md)

## The workspace

```
packages/tappet/   the library, published to npm
apps/e2e/          tappet-e2e, an Expo SDK 57 app, private
docs/              the documentation linked above
```

`vp check`, `vp test`, and `vp run -r build` at the root cover every package. The end-to-end suite is separate because it needs a device.

## License

MIT
