# touchpress

> [!WARNING]
> touchpress is highly experimental. Use at your own risk.

touchpress runs e2e tests for mobile apps on the Playwright test runner. It drives a booted simulator or emulator through [`agent-device`](https://agent-device.dev/).

```ts
import { expect, test } from 'touchpress';

test('the right credentials land on the profile', async ({ device }) => {
  await device.getByTestId('sign-in-link').tap();
  await device.getByRole('text-field', { name: 'Email' }).fill('rob@example.com');
  await device.getByTestId('password').fill('hunter2', { secret: true });
  await device.getByRole('button', { name: 'Sign in' }).tap();

  await expect(device.getByTestId('signing-in')).toBeVisible();
  await expect(device.getByTestId('profile-email')).toHaveText('rob@example.com', { exact: true });
});
```

## Usage

### Install

```sh
pnpm add -D touchpress @playwright/test
```

### Configure

```ts
// playwright.config.ts
import { defineConfig } from '@playwright/test';
import type { TouchpressOptions } from 'touchpress';

export default defineConfig<TouchpressOptions>({
  testDir: 'e2e',
  workers: 1,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    app: 'com.example.app',
    readyWhen: { testId: 'home' },
  },
  projects: [
    { name: 'ios', use: { platform: 'ios', deviceName: 'iPhone 17 Pro Max' } },
    { name: 'android', use: { platform: 'android', deviceName: 'Pixel 7 API 34' } },
  ],
});
```

Every option touchpress adds is a key of its own in `use`. Playwright merges `use` one key at a time, so what the projects share is written once at the top level and a project sets only what differs.

`readyWhen` is required. The driver returns from a launch as soon as the native process starts, before the JavaScript bundle has loaded, so touchpress waits for that locator before the first test runs.

`deviceName` is what `agent-device devices` prints, which for an Android emulator is the AVD name with its underscores shown as spaces. An AVD created as `Pixel_7_API_34` is `Pixel 7 API 34` here.

One worker gets one device. To run more than one, give `deviceName` an array with an entry per worker.

### Run

```sh
npx playwright test --project=ios
```

`preflight` reads a project's options and reports whether the device they name is booted, so a missing simulator fails once, in about a second, instead of once per test after the launch timeout. Wire it as a setup project per platform that the device projects depend on. [Basics](https://github.com/wobsoriano/touchpress/blob/main/docs/basics.md) has the spec, and [`apps/e2e/e2e/preflight.setup.mts`](https://github.com/wobsoriano/touchpress/blob/main/apps/e2e/e2e/preflight.setup.mts) is a working one.

### Drive a step with a model

`device.act` takes an instruction in English and drives the app until it is satisfied. `device.extract` asks one question about the screen and returns a typed answer.

```ts
test('sign in', async ({ device }) => {
  await device.act('Sign in with the email rob@example.com and the password hunter2');
  await expect(device.getByTestId('greeting')).toHaveText('Hi, Rob');
});
```

Set `use.aiModel` to a gateway model id or a provider model instance, and install `ai`, an optional peer dependency. A loop can run for minutes, so raise the test timeout on any spec that calls `act`. The example uses the sample app's fake account. Keep real credentials in deterministic `fill(text, { secret: true })` calls outside `act`, and assert deterministically afterwards. [AI](https://github.com/wobsoriano/touchpress/blob/main/docs/ai.md) covers `act`, `extract`, the tools the model gets, and the report.

## Run the sample project

`apps/e2e` is an Expo app with a home, login, and profile route and a fake sign-in. It is the app touchpress is tested against. Build the library first with `vp run -r build` so the app can resolve `dist`, then run these from `apps/e2e`:

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

- [Basics](https://github.com/wobsoriano/touchpress/blob/main/docs/basics.md)
- [Configuration](https://github.com/wobsoriano/touchpress/blob/main/docs/configuration.md)
- [Locators](https://github.com/wobsoriano/touchpress/blob/main/docs/locators.md)
- [Assertions](https://github.com/wobsoriano/touchpress/blob/main/docs/assertions.md)
- [AI](https://github.com/wobsoriano/touchpress/blob/main/docs/ai.md)
- [Lifecycle](https://github.com/wobsoriano/touchpress/blob/main/docs/lifecycle.md)
- [Continuous integration](https://github.com/wobsoriano/touchpress/blob/main/docs/ci.md)

## The workspace

```
packages/touchpress/  the library, published to npm
apps/e2e/          touchpress-e2e, an Expo SDK 57 app, private
docs/              the documentation linked above
```

`vp check`, `vp test`, and `vp run -r build` at the root cover every package. The end-to-end suite is separate because it needs a device.

## License

MIT
