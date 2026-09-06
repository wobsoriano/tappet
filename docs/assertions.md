# Assertions

Seven matchers, all on tappet's own `expect`, all retrying, all accepting `{ timeout }`, all working under `.not`.

| matcher                           | asserts                                    |
| --------------------------------- | ------------------------------------------ |
| `toBeVisible()`                   | the locator resolves to exactly one node   |
| `toHaveText(expected, { exact })` | that node's name or value matches          |
| `toHaveValue(expected)`           | that node's value matches, whole string    |
| `toBeEnabled()`                   | that node is enabled                       |
| `toBeSelected()`                  | that node is selected                      |
| `toBeFocused()`                   | that node is focused                       |
| `toHaveCount(n)`                  | the locator resolves to `n` distinct nodes |

They carry Playwright's own matcher names, but they are typed by their first parameter, so they surface on a tappet locator and on nothing else. Web locators are never mixed into the same `expect` here.

```ts
import { expect, test } from 'tappet';

test('the wrong password is rejected without leaving the login screen', async ({ app }) => {
  await app.getByTestId('sign-in-link').tap();
  await app.getByRole('text-field', { name: 'Email' }).fill('rob@example.com');
  await app.getByTestId('password').fill('wrong');
  await app.getByRole('button', { name: 'Sign in' }).tap();

  await expect(app.getByTestId('error')).toHaveText('Wrong email or password', { exact: true });
  await expect(app.getByTestId('profile-name')).not.toBeVisible();
});
```

`toHaveText` reads a node's name and falls back to its value, and it takes the same `{ exact }` option the text locators take. `toHaveValue` is whole-string, like Playwright's own, because a field's value is not prose to search.

## `.not`

`.not` polls for the opposite condition rather than checking once. `not.toBeVisible()` waits for a control to leave, which is what you want after tapping something that dismisses it.

Two things fail the assertion whichever way you write it. An ambiguous locator is wrong under `.not` too, and so is a device session that has died. Neither becomes a pass by inversion.

## Timeouts

Every matcher uses `expect.timeout` from the Playwright config unless the call passes its own.

```ts
await expect(app.getByTestId('signing-in')).toBeVisible({ timeout: 3000 });
```

The first evaluation happens immediately, so an expectation that already holds costs one snapshot. After that the loop takes a fresh snapshot every 250 milliseconds until the check agrees or the budget runs out.

## What a failure says

Every failed assertion answers the same five questions in the same order. Which locator, what was expected, what the screen actually held, how long we waited, and what was on screen.

This is the real output of `e2e/failing.spec.mts` in `apps/e2e`, which asserts that 'Sign out' is visible on the signed-out home screen, where it is not.

```
Error: Expected toBeVisible but it never held.

Locator: getByText('Sign out')
Expected: visible
Received: no node matched. Closest names on screen:
  @e5 [button] "Sign in"
Timeout: 3000ms (5 snapshots)

Screen:
@e1 [application] "tappet-e2e"
  @e2 [other] #home
  @e3 [text] "Welcome"
    @e4 [text] "Welcome"
  @e5 [button] "Sign in" #sign-in-link

screen.png and screen.txt are attached to this test in the HTML report.
```

The `Locator:` line is the factory call rendered back, so it reads like the line you wrote. `Received:` changes shape with the outcome. On a miss it lists the named nodes closest to what you asked for, because a miss is usually a wording drift. On an ambiguous locator it lists every match and suggests `.first()` or `.nth(n)`. `Timeout:` carries the snapshot count, which tells you whether the loop actually got to poll or the budget was spent elsewhere.

The `Screen:` listing uses `agent-device`'s own `[role] "label"` vocabulary, and it is produced by the same renderer that writes the `screen.txt` attachment, so the terminal and the report always agree. Long screens are cut at 60 nodes in the message and kept whole in the attachment.

Run that spec yourself from `apps/e2e`.

```sh
TAPPET_INCLUDE_FAILING=1 npx playwright test --project=ios e2e/failing.spec.mts
```

## Assertions tappet does not model

Reach for `app.screen()` and assert on the tree with plain `expect`. See [Basics](basics.md).
