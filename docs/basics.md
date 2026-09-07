# Basics

A tappet test is a Playwright test. You import `test` and `expect` from `tappet` instead of from `@playwright/test`, and you get one extra fixture called `device`.

```ts
// e2e/home.spec.ts
import { expect, test } from 'tappet';

test('the signed-out home screen offers a way in', async ({ device }) => {
  await expect(device.getByRole('text', { name: 'Welcome' })).toHaveText('Welcome', {
    exact: true,
  });
  await expect(device.getByRole('button', { name: 'Sign in' })).toBeEnabled();
});
```

No browser is launched. `browser`, `context`, and `page` are still there because `test` extends Playwright's own, but they are lazy and nothing in tappet names them.

## The `device` fixture

`device` is the only way into the running app. It is created fresh for every test and it is automatic, so evidence is captured even for a test that never touches it.

Three locator factories build a locator, and `device.locator()` is the escape hatch for anything they cannot express. A locator is a plain value until you await one of its methods.

```ts
device.getByText('Welcome');
device.getByRole('button', { name: 'Sign in' });
device.getByTestId('sign-in-link');
device.locator({ role: 'text-field', focused: true });
```

[Locators](locators.md) covers what each one matches and how ties are broken.

## Actions

```ts
await device.getByTestId('sign-in-link').tap();
await device.getByTestId('email').fill('rob@example.com');
await device.getByTestId('password').fill('hunter2', { secret: true });
await device.getByTestId('menu').longPress(1500);
await device.getByTestId('row-30').scrollIntoView();
await device.scroll('down');
await device.relaunch();
await device.dismissDevOverlay();
```

Actions wait for their target the way Playwright actions do. Playwright's own `use.actionTimeout` is the whole budget for one action, so waiting for the target and waiting for the screen to go quiet afterwards share it. Each action is reported as one step in the list and HTML reporters.

A fill step title names the locator and never the text.

```
fill getByTestId('email')
  type "rob@example.com"
```

The value is a nested step, added once the node is resolved and the write has gone out. It has to be reported after the node rather than with the locator, because the node's role is what decides how much of the value may be printed. A field the device marks secure, or one you filled with `{ secret: true }`, reports a count instead.

```
fill getByTestId('password')
  type 7 characters
```

`fill` is the one action that reads back what it wrote. A device keyboard drops early keystrokes often enough that a fill can under-deliver its text and still report success, so `fill` types again until the field holds what it was given or the budget runs out. Re-filling is safe because a fill replaces the field's contents rather than appending to them.

The read back is two reads. Behind a controlled component the field gets written twice, once by the driver and once by the app's own render, and that second write can put a stale string back over what was just typed. A single read can land between the two and report a value that is already gone, so `fill` reads once, waits `settleQuietMs`, and reads again. Both have to agree before it returns.

That quiet period is reserved out of the action's budget rather than taken from what is left. A fill that cannot afford to confirm itself reports `fill-unconfirmed` instead of starting an attempt it would have to accept on a window that shrank to nothing.

A retry re-sends the same fill. Pacing the keystrokes instead was tried and removed. The driver's per-character delay routes the write down a path that appends to the field rather than replacing it, so a paced retry turned `rob@example.com` into `r@example.comrob@example.com` and never converged. When the budget runs out, the error names the value that was actually there and the number of attempts.

A secure field is read back differently, because it never reports its contents. It reports one masking character per character it holds, so what the read back checks there is the length. That still catches the dropped keystroke this exists for, because a short write is a short mask, and the failure names how many characters were typed rather than the text, so a password stays out of the terminal and out of the HTML report.

Plenty of apps put a credential in a plain text field, and a snapshot gives tappet no way to tell. `{ secret: true }` says so.

```ts
await device.getByTestId('password').fill('hunter2', { secret: true });
```

The step and the failure then say as little as they would about a field the platform marked secure. The nested step reports a count, and `fill-unconfirmed` names both values by length. The read back itself is unchanged, because a plain field really does hand its contents back, so a secret fill is still confirmed character for character rather than by length.

`secret` is fill's option alone. `tap`, `longPress` and `scrollIntoView` take `{ timeout }` and nothing else.

`secret` covers what tappet says about the write. It does not cover what the device says about the field afterwards. The snapshot carries no mark for the field, so an assertion on that field's own value still prints what the field holds, and on Android a plain text field reports its contents as its accessibility name, which puts them in the screen listing. Assert on what the credential got you rather than on the credential.

## Reaching a target below the fold

`tap`, `fill` and `longPress` scroll to their own target. A locator that resolves to nothing is not immediately a failure, so before the action gives up it looks for the node off screen and scrolls toward it, inside the same action budget. Most tests never have to say anything about scrolling.

```ts
await device.getByTestId('list-done').tap();
```

`scrollIntoView()` does the scrolling and stops there, for when you want to see a node rather than act on it.

```ts
const row = device.getByTestId('row-30');
await row.scrollIntoView();
await expect(row).toBeVisible();
```

Both stop on the same condition. The locator resolves to exactly one node on the tree every other locator resolves against, which is the driver's visible-first view of the screen. A node the search found while looking is not a node a user can reach, so nothing acts on one.

Which way to scroll comes from two places. The driver can hand back the full provider tree rather than its visible view, and on iOS that tree carries the rows a container has scrolled away. Their rects against the rect of the container clipping them say which way the target lies, so the search knows rather than guesses.

Android's provider tree stops at the window. It carries more wrapper views than the visible one and not one extra row, so nothing there places an off-screen target. What is left is the scroll container itself, which reports that it is holding content above or below. The search scrolls that way and re-reads the screen until the target arrives. Same loop, weaker evidence.

A search never reverses. Once it has scrolled one way, a hint pointing back the other way means the container ran out rather than that the target is behind it, so that is where the search stops. It also stops after twenty steps whatever the clock says, so a list that scrolls forever cannot spend the whole budget. A failure names the steps it took.

```
Locator never resolved to a node within 10000ms.

Locator: getByTestId('row-99')
Scrolled: 3 steps down
```

Every scroll a search takes is a nested step under the action, so a report shows what an action did to reach its target.

```
tap getByTestId('list-done')
  scroll down
```

`device.scroll('down')` is still there for scrolling the screen without naming a target.

`relaunch()` relaunches the app and waits for the ready gate again. `dismissDevOverlay()` clears the React Native development warning overlay. It is never automatic, because the overlay is a real node and hiding it by default would suppress a warning a test might want to assert on.

## Reading values

`count()` returns how many distinct nodes a locator resolves to, after absorption.

```ts
expect(await device.getByRole('cell').count()).toBe(3);
```

`textContent()` returns the text of the one node a locator resolves to, or `null` when it resolves to nothing.

```ts
const name = await device.getByTestId('profile-name').textContent();
```

It takes one snapshot and reads it once. It does not retry, so use it to capture a value you already asserted on rather than to wait for one. A locator that matches more than one node throws the strict-mode error instead of picking one.

## The whole tree

`device.screen()` returns the parsed accessibility tree for an assertion tappet does not model.

```ts
const screen = await device.screen();
const labels = screen.nodes.filter((node) => node.role === 'button').map((node) => node.name);
```

Each `ScreenNode` carries `ref`, `role`, `rawType`, `name`, `value`, `testId`, `rect`, `enabled`, `selected`, `focused`, `hiddenContentAbove`, `hiddenContentBelow`, its `index` among its siblings, a `parent` link, and its `depth`. The two hidden-content flags are the driver's own hints on a scroll container, and they are what a screen listing prints as `[more above]` and `[more below]`. The tree is frozen. It is one observation of the device, never refreshed in place, because every command the driver runs invalidates the refs a previous snapshot handed out.

## Screenshots

`device.screenshot()` saves a PNG of the device and returns the path the driver wrote it to.

```ts
const path = await device.screenshot();
await device.screenshot({ path: 'card.png' });
```

The default path is numbered per call and goes through the same output directory the runner gives the test, so it is unique per test and per retry attempt. An explicit path is used as given. Nothing is attached to the report, so the caller decides whether the file belongs in the run's output. Each call is reported as one step.

The agent-device CLI equivalent is `agent-device screenshot ./card.png`, which also takes `--scale` and `--overlay-refs`.
Element screenshots are not supported through tappet yet.

## Preflight

`preflight` answers one question before any test opens a session. Is the device this project names actually booted?

```ts
// e2e/preflight.setup.mts
import { preflight, setupTest } from 'tappet';

setupTest(
  'the project names a booted device',
  async ({ platform, app, readyWhen, deviceName, sessionPrefix }) => {
    const report = await preflight({ platform, app, readyWhen, deviceName, sessionPrefix });
    if (report.ok) return;
    throw new Error(report.problems.join('\n'));
  },
);
```

`setupTest` carries tappet's options and none of its fixtures. Tappet's own `test` would open a session through its auto `device` fixture, which is the very thing preflight runs ahead of.

It returns `{ ok: true, device }` or `{ ok: false, problems }`, where every problem is one line ending in something to do about it. Run it as a Playwright setup project that the device projects depend on, so a missing simulator reads as one short failure rather than a launch timeout in every test.

Give each platform its own setup project off this one spec. A setup project has a single `use`, so a shared one could only check one platform's device, and running the other platform would gate on a device that run has no reason to have booted. [Configuration](configuration.md) shows the wiring.

## Specs must load as ES modules

`agent-device` is ESM only. A spec that Node loads as CommonJS cannot resolve it. Inside a package without `"type": "module"`, such as an Expo app, name your specs `*.spec.mts`.
