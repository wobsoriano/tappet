# playwright-agent-device

Native mobile end-to-end tests with `@playwright/test` as the runner and Callstack [`agent-device`](https://agent-device.dev/) as the driver. No browser is launched. Tests read like Playwright tests, and the locators resolve against the accessibility tree of a real simulator or emulator.

## A test

```ts
// e2e/login.spec.mts
import { test, expect } from "playwright-agent-device";

test("the right credentials land on the profile", async ({ app }) => {
  await app.getByTestId("sign-in-link").tap();
  await app.getByRole("text-field", { name: "Email" }).fill("rob@example.com");
  await app.getByTestId("password").fill("hunter2");
  await app.getByRole("button", { name: "Sign in" }).tap();

  await expect(app.getByTestId("signing-in")).toBeVisible();
  await expect(app.getByRole("text", { name: "Rob", exact: true })).toBeVisible();
});
```

```ts
// playwright.config.ts
import { defineConfig } from "@playwright/test";
import type { DeviceTestOptions } from "playwright-agent-device";

const shared = { app: "com.example.app", readyWhen: { text: "Welcome" } };

export default defineConfig<DeviceTestOptions>({
  testDir: "e2e",
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [["list"], ["html", { open: "never" }]],
  projects: [
    { name: "ios", use: { device: { ...shared, platform: "ios" } } },
    { name: "android", use: { device: { ...shared, platform: "android" } } },
  ],
});
```

Nothing in a test names a session, a ref, a generation, a selector string, or a step. `device` is the only key this package adds to `use`. Playwright merges `use` one key at a time, so a project that sets `device` replaces it whole. Spread a shared constant, as above.

That test is a real one. It runs against `apps/e2e` in this workspace, which is the reference consumer and the only app this package is proven against. Its `playwright.config.ts` is the same shape filled in, and it pins a device name per project because more than one simulator is usually booted.

## Prerequisites

This package drives an app you already built and installed. It never builds, installs, or boots anything.

- A booted simulator or emulator. Boot it yourself, or with `agent-device device boot`.
- Your app installed on that device, as a development or release build.
- Your bundler running if the build needs one. For a React Native development build that means Metro on port 8081.
- No other project's Metro on that port. A development build silently loads whichever bundle answers, so a stray server means your tests drive someone else's app.
- `@playwright/test` 1.63 or newer and `agent-device` 0.20.10 or newer, both peer dependencies. Node 22.12 or newer.
- Specs that load as ES modules. `agent-device` is ESM only, so a spec Node loads as CommonJS cannot resolve it. Inside a package without `"type": "module"`, such as an Expo app, name them `*.spec.mts`.
- The globally installed `agent-device` CLI at the same version as the one in your project. The client and the CLI share one daemon, and a version mismatch makes each side restart it, which drops every open session.
- One device per worker. Running more than one worker needs `name` to be an array with an entry per worker. Two workers pointed at one device would fight over its claim, so that is a configuration error rather than a race.

`readyWhen` is required for this reason. `agent-device` returns from `open` as soon as the native process launches, while the JavaScript bundle is still loading, so the first assertion of the first test would otherwise race the bundle.

## Locators

`app.getByText(text, { exact })` matches a node's accessibility name or its value. `app.getByRole(role, { name, exact })` matches the normalized role and, optionally, the name. `app.getByTestId(id)` matches the accessibility identifier, which is what a React Native `testID` becomes. `app.locator(query)` takes a raw query for anything the three cannot express.

Text matching follows Playwright. The default is a case-insensitive substring after whitespace is collapsed. `exact: true` compares the whole string, case-sensitively, still after collapsing. A `RegExp` is tested against the collapsed name.

A locator that resolves to more than one node is an error, both for an action and for an assertion, and `.not` cannot turn that into a pass. Take one deliberately with `.first()` or `.nth(n)`, or narrow with a role. One case is handled for you. When several matches sit on one ancestor chain and carry the same text, only the deepest survives, so a labelled container and the text node inside it count as one thing on screen.

Roles are normalized to one vocabulary across iOS and Android, spelled the way `agent-device snapshot` prints them: `application`, `window`, `button`, `text`, `text-field`, `secure-text-field`, `link`, `image`, `switch`, `slider`, `tab-bar`, `scroll-area`, `cell`, `alert`, `other`.

## Actions

`Locator.tap()`, `Locator.fill(text)`, `Locator.longPress(ms)`, and `Locator.count()`. On the app itself: `App.scroll(direction)`, `App.restart()`, `App.dismissDevOverlay()`, and `App.screen()` for the parsed tree.

Actions wait for their target the way Playwright actions do. `actionTimeout` is the whole budget for one action, so waiting for the target and waiting for the screen to settle afterwards share it. Each action is reported as a single step.

`fill` is the one action that reads back what it wrote. A device keyboard drops early keystrokes often enough that a fill can under-deliver its text and still report success, so `fill` types again until the field holds what it was given or `actionTimeout` runs out. Re-filling is safe because a fill replaces the field's contents rather than appending to them. A fill that never lands names the locator, the text it wanted, the text it got, and how many times it tried.

## Matchers

Seven retrying matchers, all on this package's own `expect`, all accepting `{ timeout }`, all working under `.not`.

| matcher                           | asserts                                    |
| --------------------------------- | ------------------------------------------ |
| `toBeVisible()`                   | the locator resolves to exactly one node   |
| `toHaveText(expected, { exact })` | that node's name or value matches          |
| `toHaveValue(expected)`           | that node's value matches, whole string    |
| `toBeEnabled()`                   | that node is enabled                       |
| `toBeSelected()`                  | that node is selected                      |
| `toBeFocused()`                   | that node is focused                       |
| `toHaveCount(n)`                  | the locator resolves to `n` distinct nodes |

`.not` polls for the opposite condition rather than checking once, so `not.toBeVisible()` waits for a control to leave. An ambiguous locator and a device session that has died both fail the assertion whichever way you write it.

A failed assertion prints the locator as written, what was expected, what the screen actually held, how many snapshots were taken, and a listing of the screen in `agent-device`'s own `[role] "label"` vocabulary. `screen.png` and `screen.txt` are attached to the test, so the HTML report carries the same evidence.

## Options

Everything goes in `use.device`, parsed once at worker start.

| field               | default        | meaning                                                                                 |
| ------------------- | -------------- | --------------------------------------------------------------------------------------- |
| `platform`          | required       | `'ios'` or `'android'`                                                                  |
| `app`               | required       | bundle id or package name, never an artifact path                                       |
| `readyWhen`         | required       | the locator that means the bundle loaded: `{ text }`, `{ testId }`, or `{ role, name }` |
| `name`              | first booted   | device name. An array is a pool indexed by Playwright's `parallelIndex`                 |
| `relaunch`          | `'per-test'`   | or `'per-worker'`                                                                       |
| `onDeviceInUse`     | `'fail'`       | or `'reclaim'`. Leftovers carrying this library's own prefix are always reclaimed       |
| `actionTimeout`     | `10_000`       | how long an action waits for its target, settle included                                |
| `settleQuietMs`     | `500`          | the quiet window that ends the post-action settle                                       |
| `launchTimeout`     | `90_000`       | budget for the open plus the ready gate                                                 |
| `dismissDevOverlay` | `false`        | send `react-native dismiss-overlay` after every launch                                  |
| `evidence`          | `'on-failure'` | `'always'` or `'off'`                                                                   |
| `sessionPrefix`     | `'pwad'`       | session names are `${prefix}-${project}-${parallelIndex}`                               |

## Lifecycle

One `agent-device` session is opened per worker slot and named `${sessionPrefix}-${project}-${parallelIndex}`, which is deterministic so a worker replaced after a failure reuses it. Startup closes any leftover of that name, opens the app with a relaunch and the device selection on that first command, recovers once from a device claimed by one of our own leftovers or by `onDeviceInUse: 'reclaim'`, recovers once from a session bound to another device, and then holds until `readyWhen` resolves. Every command on that session runs on one queue, reads included, because a snapshot between a resolution and the action pinned to it would invalidate the pin. Each action is therefore one atomic unit: capture a screen, resolve the locator, pin the ref to that screen's generation, dispatch, and retry once if the driver reports the generation was superseded. Before each test after the first, the app is relaunched and the ready gate runs again, so no test inherits the previous test's screen. On failure the session captures a screenshot and a screen listing, then the worker fixture closes the session on exit. The simulator is never shut down.

## Beyond Playwright

`playwright-agent-device/core` is the runner-independent half: `openSession`, `createApp`, `probe`, `DeviceTestError`, and the types around them. It imports neither `@playwright/test` nor `agent-device`. An adapter for another runner implements `ActionSink`, calls `openSession` with its own worker slot, and registers matchers over `probe`.

## License

MIT
