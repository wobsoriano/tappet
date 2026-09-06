# Basics

A tappet test is a Playwright test. You import `test` and `expect` from `tappet` instead of from `@playwright/test`, and you get one extra fixture called `app`.

```ts
// e2e/home.spec.mts
import { expect, test } from 'tappet';

test('the signed-out home screen offers a way in', async ({ app }) => {
  await expect(app.getByRole('text', { name: 'Welcome' })).toHaveText('Welcome', { exact: true });
  await expect(app.getByRole('button', { name: 'Sign in' })).toBeEnabled();
});
```

No browser is launched. `browser`, `context`, and `page` are still there because `test` extends Playwright's own, but they are lazy and nothing in tappet names them.

## The `app` fixture

`app` is the only way into the device. It is created fresh for every test and it is automatic, so evidence is captured even for a test that never touches it.

Four locator factories build a locator. A locator is a plain value until you await one of its methods.

```ts
app.getByText('Welcome');
app.getByRole('button', { name: 'Sign in' });
app.getByTestId('sign-in-link');
app.locator({ role: 'text-field', focused: true });
```

[Locators](locators.md) covers what each one matches and how ties are broken.

## Actions

```ts
await app.getByTestId('sign-in-link').tap();
await app.getByTestId('email').fill('rob@example.com');
await app.getByTestId('menu').longPress(1500);
await app.scroll('down');
await app.restart();
await app.dismissDevOverlay();
```

Actions wait for their target the way Playwright actions do. `actionTimeout` is the whole budget for one action, so waiting for the target and waiting for the screen to go quiet afterwards share it. Each action is reported as one step in the list and HTML reporters.

`fill` is the one action that reads back what it wrote. A device keyboard drops early keystrokes often enough that a fill can under-deliver its text and still report success, so `fill` types again until the field holds what it was given or the budget runs out. Re-filling is safe because a fill replaces the field's contents rather than appending to them.

`restart()` relaunches the app and waits for the ready gate again. `dismissDevOverlay()` clears the React Native development warning overlay. It is never automatic, because the overlay is a real node and hiding it by default would suppress a warning a test might want to assert on.

## Reading values

`count()` returns how many distinct nodes a locator resolves to, after absorption.

```ts
expect(await app.getByRole('cell').count()).toBe(3);
```

`textContent()` returns the text of the one node a locator resolves to, or `null` when it resolves to nothing.

```ts
const name = await app.getByTestId('profile-name').textContent();
```

It takes one snapshot and reads it once. It does not retry, so use it to capture a value you already asserted on rather than to wait for one. A locator that matches more than one node throws the strict-mode error instead of picking one.

## The whole tree

`app.screen()` returns the parsed accessibility tree for an assertion tappet does not model.

```ts
const screen = await app.screen();
const labels = screen.nodes.filter((node) => node.role === 'button').map((node) => node.name);
```

Each `ScreenNode` carries `ref`, `role`, `rawType`, `name`, `value`, `testId`, `rect`, `enabled`, `selected`, `focused`, a `parent` link, and its `depth`. The tree is frozen. It is one observation of the device, never refreshed in place, because every command the driver runs invalidates the refs a previous snapshot handed out.

## Preflight

`preflight` answers one question before any test opens a session. Is the device this project names actually booted?

```ts
// e2e/preflight.setup.mts
import { test as base } from '@playwright/test';
import { preflight, type DeviceTestOptions } from 'tappet';
import { UNCONFIGURED_DEVICE } from 'tappet/core';

const setup = base.extend<object, DeviceTestOptions>({
  device: [UNCONFIGURED_DEVICE, { option: true, scope: 'worker' }],
});

setup('the project names a booted device', async ({ device }) => {
  const report = await preflight(device);
  if (report.ok) return;
  throw new Error(report.problems.join('\n'));
});
```

It returns `{ ok: true, device }` or `{ ok: false, problems }`, where every problem is one line ending in something to do about it. Run it as a Playwright setup project that the device projects depend on, so a missing simulator reads as one short failure rather than a launch timeout in every test.

Give each platform its own setup project off this one spec. A setup project has a single `use`, so a shared one could only check one platform's device, and running the other platform would gate on a device that run has no reason to have booted. [Configuration](configuration.md) shows the wiring.

## Specs must load as ES modules

`agent-device` is ESM only. A spec that Node loads as CommonJS cannot resolve it. Inside a package without `"type": "module"`, such as an Expo app, name your specs `*.spec.mts`.
