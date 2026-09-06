# tappet

> [!WARNING]
> tappet is experimental. The API will change between minor versions, so pin the version you install. Every run behind this repository has been an iOS simulator or an Android emulator. Physical devices and cloud device farms are untested.

tappet runs end-to-end tests for mobile apps on the Playwright test runner. It drives a booted simulator or emulator through Callstack [`agent-device`](https://agent-device.dev/) and launches no browser. Locators keep Playwright semantics, so `getByRole`, `getByText`, and `getByTestId` resolve against the accessibility tree, a locator that matches two things is an error rather than a guess, and matchers retry until they hold. A test that fails prints the screen it was looking at and attaches a screenshot and a tree listing to the HTML report.

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

### Requirements

- Node 22.12 or newer. That release can `require` ES modules, which is what lets a CommonJS project, such as an Expo app, keep plain `.spec.ts` files even though `agent-device` ships only ES modules.
- A booted simulator or emulator. Boot it yourself or with `agent-device device boot`.
- Your app already installed on that device. tappet never builds, installs, or boots anything.
- Your bundler running if the build needs one. For a React Native development build that means Metro on port 8081, and no other project's Metro may hold that port.

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

`readyWhen` is required. The driver returns from a launch as soon as the native process starts, while the JavaScript bundle is still loading, so tappet holds until that locator resolves before the first test runs.

`name` is what `agent-device devices` prints, which for an Android emulator is the AVD name with its underscores shown as spaces. An AVD created as `Pixel_7_API_34` is `Pixel 7 API 34` here.

One worker gets one device. To run more than one, give `name` an array with an entry per worker.

### Run

```sh
npx playwright test --project=ios
```

A wrong device name is worth catching before the launch timeout does. `preflight` reads a project's `device` option and answers whether that device is booted, so a missing simulator fails once in a second rather than once per test. Wire it as a setup project per platform that the device projects depend on. [Basics](https://github.com/wobsoriano/tappet/blob/main/docs/basics.md) has the spec, and [`apps/e2e/e2e/preflight.setup.mts`](https://github.com/wobsoriano/tappet/blob/main/apps/e2e/e2e/preflight.setup.mts) is a working one.

## Run the sample project

`apps/e2e` is an Expo app with three routes, home, login, and profile, and a fake sign-in, and it is the app tappet is proven against. Build the library first with `vp run -r build`, so the app resolves its `dist`. Then, from `apps/e2e`:

```sh
npx expo run:ios --device 'iPhone 17 Pro Max' --no-bundler
npx expo start --port 8081
npx playwright test --project=ios
```

Android is the same shape. `expo run:android` wants the AVD's own name, underscores and all, rather than the spaced name the test config uses, and an emulator needs `adb reverse` to reach Metro on the host.

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
- [Design](https://github.com/wobsoriano/tappet/blob/main/docs/DESIGN.md)

## The workspace

```
packages/tappet/   the library, published to npm
apps/e2e/          tappet-e2e, an Expo SDK 57 app, private
docs/              the documentation linked above
```

`vp check`, `vp test`, and `vp run -r build` at the root cover every package. The end-to-end suite is separate because it needs a device.

## License

MIT
