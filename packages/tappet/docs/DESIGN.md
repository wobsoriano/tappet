# tappet design

The package was renamed from `playwright-agent-device` to `tappet`, and `DeviceTestError` to `TappetError`, after this document was written. Nothing else about the design changed.

Native mobile end-to-end tests with `@playwright/test` as the runner and Callstack `agent-device` as the driver. No browser is launched. This document is the contract the implementation is built against. It was synthesized from three parallel design candidates and a set of live probes against a sample Expo SDK 57 app on an iOS simulator.

## What a test looks like

```ts
// e2e/login.spec.mts
import { test, expect } from 'tappet';

test('the right credentials land on the profile', async ({ app }) => {
  await app.getByTestId('sign-in-link').tap();
  await app.getByRole('text-field', { name: 'Email' }).fill('rob@example.com');
  await app.getByTestId('password').fill('hunter2');
  await app.getByRole('button', { name: 'Sign in' }).tap();

  await expect(app.getByTestId('signing-in')).toBeVisible();
  await expect(app.getByRole('text', { name: 'Rob', exact: true })).toBeVisible();
});
```

```ts
// playwright.config.ts
import { defineConfig } from '@playwright/test';
import type { DeviceTestOptions } from 'tappet';

const shared = { app: 'com.example.app', readyWhen: { text: 'Welcome' } };

export default defineConfig<DeviceTestOptions>({
  testDir: 'e2e',
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  projects: [
    { name: 'ios', use: { device: { ...shared, platform: 'ios' } } },
    { name: 'android', use: { device: { ...shared, platform: 'android' } } },
  ],
});
```

Nothing in a test names a session, a ref, a generation, a selector string, or `test.step`. `device` is the only key the library adds to `use`. Playwright merges `use` one key at a time, so a project that sets `device` replaces it whole; spread a shared constant.

The `apps/e2e` app in this workspace is the reference consumer. Its `playwright.config.ts` is the same shape against a real app, and it pins a device name per project because more than one simulator is usually booted.

## Facts the shape rests on

All verified this session (see the grounding record in the session scratchpad; the load-bearing ones are repeated here so the code can cite them).

1. agent-device's own read primitives disagree with each other on the real Home screen. `wait text "Live from the cloud"` times out while its error lists that text as present. `is visible` fails on selectors `wait` accepts. The JSON path of the same `wait` returns `AMBIGUOUS_MATCH`. Bare `find` taps. The one consistent primitive is `capture.snapshot()`, which returns the full tree with `label`, `type`, `identifier`, `rect`, `selected`, `enabled`, `parentIndex`, `refsGeneration` in about 140 ms. So the library owns matching in process and uses the driver only for capture and mutation.
2. Refs are per frame. Every snapshot advances `refsGeneration`. A pinned ref `@e15~s<gen>` works only as the very next command after the snapshot that minted it. A stale pin fails with `COMMAND_FAILED` and `details.reason === 'ref_generation_mismatch'`. Therefore "snapshot, resolve, pin, act" is one atomic unit on a single per-session queue, and every command, reads included, goes through that queue.
3. Sessions live in the daemon and outlive the process. A device claim is a file under `~/.agent-device/device-claims/`. A claim from another workspace does not appear in `sessions.list()` from this workspace but still makes `apps.open` fail with `DEVICE_IN_USE` naming the owner. A session binds to a device on its first command, even a read-only one, and a later open with a different selection fails with `INVALID_ARGS`. A relaunch with the same or no selection on a bound session succeeds.
4. `apps.open` returns when the native process launches. The JavaScript bundle is still loading. If another Metro owns port 8081 the app silently loads a different project's bundle. A ready gate is therefore required configuration, and it is a locator wait, never `wait stable`.
5. Playwright discards the worker process after any test failure and starts a replacement that reuses `parallelIndex`. Fixture teardown runs after a timeout with its own budget. `expect.extend` matchers on a non-Locator receiver work under Playwright's own names (`toBeVisible`, `toHaveText`, ...), receive `this.timeout` from `expect.timeout`, and see `this.isNot`. Steps and attachments show in the list and HTML reporters. No trace.zip is produced without a browser, so the HTML report is the evidence surface.
6. `hittable` is `false` on every node of this app under the XCTest backend while presses succeed. It cannot gate actionability.
7. agent-device 0.20.10's root entry exports only values. Types are derived with `ReturnType<typeof createAgentDeviceClient>` in one file.

## Module map

```
src/
  index.ts                 Playwright adapter entry: test, expect, types
  core/
    index.ts               runner-independent entry: openSession, createApp, probe, TappetError, types
    config.ts              DeviceOptions, ResolvedOptions, parseDeviceOptions
    query.ts               Query, TextMatch, Role, normalizeText, describeQuery
    screen.ts              ScreenNode, Screen, PinnedRef, RawSnapshot, parseScreen, resolve, pin, renderScreen
    driver.ts              DeviceDriver port, Binding, DeviceFailure, OpenRequest, Settled
    session.ts             SessionState, Queue, DeviceSession, openSession, sessionName
    app.ts                 App, Locator, createApp, action pipeline, pollUntil
    checks.ts              Check (assertion as data), evaluate, describeCheck
    probe.ts               probe (the retrying loop), formatFailure
    evidence.ts            captureEvidence
    report.ts              ActionSink, ActionRecord, renderTitle, silentSink
    errors.ts              TappetError, ErrorInfo
  driver/
    agent-device.ts        the only file that imports agent-device; classifyError
  playwright/
    fixtures.ts            device option, session worker fixture, app auto fixture, playwrightSink
    expect.ts              retrying matcher factory over probe
```

`core/` imports nothing from `@playwright/test` or `agent-device`. `driver/agent-device.ts` implements the `DeviceDriver` port. `playwright/` implements `ActionSink` and the fixture graph. A Vitest adapter is a third sibling that implements `ActionSink`, calls `openSession` with its own worker id as the slot, and registers matchers over `probe`. It touches nothing in `core/`.

Package exports: `.` is the Playwright adapter (`test`, `expect`, `DeviceTestOptions`, `App`, `Locator`). `./core` is the runner-independent surface for adapter authors. No agent-device type is re-exported from either.

## The data structures

**`Query`** (`core/query.ts`). Pure conjunctive value: `{ testId?, name?, value?, role?, enabled?, selected?, focused?, where?, index? }` where the string fields are `TextMatch = { kind: 'substring' | 'exact', value } | { kind: 'regex', value: RegExp }`. `getByText(t, { exact? })` is `{ name: t }` matched against name or value. `getByRole(r, { name?, exact? })` is `{ role, name }`. `getByTestId(id)` is `{ testId: exact }`. `app.locator(query)` is the escape hatch. Default text matching is Playwright's: case-insensitive substring after whitespace normalization; `exact: true` is whole-string, case-sensitive, still normalized. `index` is the strictness opt-out set by `.first()` and `.nth(n)`.

**`Screen`** (`core/screen.ts`). Frozen parse of one `capture.snapshot()` result: `nodes: ScreenNode[]`, `generation`, `appId`, `truncated`, `capturedAt`. `ScreenNode` has `ref`, `index`, `parent` link built from `parentIndex`, `depth`, `role` (normalized via a role table, the only place iOS and Android differ), `rawType`, `name` (normalized label), `value`, `testId` (from `identifier`), `rect`, `enabled`, `selected`, `focused`. `parseScreen(raw: RawSnapshot, platform)` takes a structurally declared raw shape so the core never imports agent-device and a JSON fixture satisfies it. `PinnedRef` is a branded string only `pin(screen, node)` can produce.

**`resolve(screen, query): Resolution`** is the single resolver for actions and assertions. `Resolution = one | none (with nearest names) | many (with the distinct nodes)`. Rule order: filter by every query field, then ancestor absorption (when matches form one ancestor chain carrying the same matched string, only the deepest survives, so the `[other] "Live from the cloud"` container collapses into its `[text]` child and the `[other] "Home"` wrapper collapses into the `[button]`), then `index`. Matches in disjoint subtrees stay distinct: `getByText('Explore')` on the Explore screen is `many` (heading and tab button) and the message says so and suggests `getByRole`.

**`SessionState`** (`core/session.ts`). `ready { binding } | closed { reason } | broken { failure }`. There is no unopened or opening variant because `openSession` is the only constructor and it returns after `apps.open` succeeded and the ready gate passed. `Binding` is minted only by the driver's `open`, so "we think we have a device" cannot drift from "we have one". `broken` carries the first failure so later calls report the root cause.

**`Check`** (`core/checks.ts`). Assertion as data: `toBeVisible | toHaveText(expected, exact) | toHaveValue(expected) | toBeEnabled | toBeSelected | toBeFocused | toHaveCount(n)`. `evaluate(check, resolution): Verdict` is pure and exhaustive over the union. Adapters turn each name into a matcher; the poll and the message live in `probe`.

**`DeviceFailure`** (`core/driver.ts`). The driver's error vocabulary translated once, in `driver/agent-device.ts`: `device-busy { owner }`, `device-missing`, `app-missing`, `session-rebound { boundTo }`, `stale-ref`, `ambiguous`, `timeout`, `unknown { code, logPath }`. `stale-ref` is detected by `code === 'COMMAND_FAILED' && details.reason === 'ref_generation_mismatch'`. `device-busy` reads the owner from `details` first and from the message text (`by session "lex"`) second.

## Lifecycle

`openSession({ options, slot, scope, sink, driver? })`, convergent startup in this order:

1. Session name is `${prefix}-${scope}-${slot}`. `prefix` defaults to `tappet`, `scope` is the Playwright project name, `slot` is `parallelIndex`. Deterministic, so a replacement worker after a failure reuses it.
2. Device for the slot is `names[slot]` when `name` is an array (typed config error if the pool is short), else the single name, else the platform's first booted device.
3. `driver.close({ session: name })` ignoring "not found". This reclaims a leftover from a previous crashed run.
4. `driver.open({ app, platform, device, session, relaunch: true })`. Selection rides on this first command.
5. On `device-busy`: if the owner starts with our prefix, or `onDeviceInUse === 'reclaim'`, close the owner and retry step 4 once. Otherwise throw `device-in-use` with the owner and the release command in the message.
6. On `session-rebound`: close by name, retry step 4 once.
7. If `dismissDevOverlay`, send it. Then poll `readyWhen` up to `launchTimeout` or throw `not-ready` with the screen listing.

Running it twice converges to one `ready` session. `close()` is idempotent, never shuts the simulator down, and moves to `closed` even when the driver call fails.

Playwright fixture graph: `device` (worker option) → `session` (worker, `timeout: 180_000`, `openSession`) → `app` (test, auto). The `app` fixture, on setup, relaunches when `relaunch === 'per-test'` and this is not the worker's first test (the worker open already relaunched), re-runs the ready gate, then hands out `createApp(session, sink)`. On teardown, when `testInfo.status !== testInfo.expectedStatus` (or `evidence === 'always'`), it captures `screen.png` and `screen.txt` via the sink before the worker fixture closes the session. A capture failure is annotated and swallowed so it never replaces the real error. Per-test relaunch is the default because a passing test that navigated away must not leave the next test on a random screen, and a failed test already triggers a worker replacement that relaunches.

## Actions

`Locator.tap()`, `Locator.fill(text)`, `Locator.longPress(ms?)`, `App.scroll(direction)`, `App.restart()`, `App.dismissDevOverlay()`, `App.screen()`, `Locator.count()`. Each `Locator` action is one queued unit reported as one step titled by `renderTitle` (for example `tap getByRole('button', { name: 'Explore' })`):

```
poll screen until resolve() is `one` (actionTimeout; `many` fails at once with the list)
pin the ref to the screen's generation
driver.tap(pinnedRef, { settle: true, settleQuietMs, timeoutMs })
on stale-ref: re-capture and retry once
```

Actions wait for their target like Playwright actions do. Selectors are never sent to the driver, so its ambiguity policy, which changed between 0.20.3 and 0.20.7, never reaches a test.

## Assertions

`probe(locator, check, { negate, timeoutMs, intervalMs })` polls a fresh screen until `evaluate(check, resolve(screen, query)).pass === !negate`, first evaluation immediately, then every 250 ms. A `broken` session ends the loop at once. It never throws for a failed expectation; it returns `{ pass, message }` and the adapter's matcher returns that to Playwright. The Playwright adapter builds all seven matchers with one `retrying` factory so `options?.timeout ?? this.timeout` and `this.isNot` are written once. `.not` polls for the opposite condition, so `not.toBeVisible()` waits for a control to leave.

`formatFailure` produces, in order: header, `Locator:` as written, `Expected:`, `Received:` (the strict-mode list on `many`, the nearest names on `none`), `Timeout:` with the snapshot count, `Screen:` from `renderScreen` in the CLI's own `[role] "label"` vocabulary, and the attachment note. The same renderer produces `screen.txt`, so terminal and report agree.

## Configuration

`use.device`, parsed once by `parseDeviceOptions` at worker start; nothing downstream re-validates.

| field               | default        | meaning                                                                                           |
| ------------------- | -------------- | ------------------------------------------------------------------------------------------------- |
| `platform`          | required       | `'ios'` or `'android'`                                                                            |
| `app`               | required       | bundle id or package name, never an artifact path                                                 |
| `readyWhen`         | required       | locator-shaped query that means the bundle loaded (`{ text }`, `{ testId }`, or `{ role, name }`) |
| `name`              | first booted   | device name; an array is a pool indexed by `parallelIndex`                                        |
| `relaunch`          | `'per-test'`   | or `'per-worker'`                                                                                 |
| `onDeviceInUse`     | `'fail'`       | or `'reclaim'`; own-prefix leftovers are always reclaimed                                         |
| `actionTimeout`     | `10_000`       | wait for an action target, including settle                                                       |
| `settleQuietMs`     | `500`          | quiet window that ends the post-action settle                                                     |
| `launchTimeout`     | `90_000`       | budget for open plus the ready gate                                                               |
| `dismissDevOverlay` | `false`        | send `react-native dismiss-overlay` after every launch                                            |
| `evidence`          | `'on-failure'` | `'always'` or `'off'`                                                                             |
| `sessionPrefix`     | `'tappet'`     | session names are `${prefix}-${project}-${parallelIndex}`                                         |

## Synthesis decision

Three candidates were produced in parallel on three models and cross-judged by a fourth agent against a six-point rubric. The judge scored opus 30, fable 24, sonnet 19 and picked opus as base; I reached the same base independently.

**Base: the opus candidate.** Kept: the `DeviceDriver` port so the core has no agent-device import and is unit-testable against a captured snapshot; `Query` as a general conjunctive value; `Screen` with real parent links; ancestor absorption in one resolver shared by actions and assertions; the required ready gate; `DeviceFailure` as the single translation of driver errors; `ActionSink` with `outputPath` so per-retry paths come from the runner; `evidence: on-failure | always | off`; nearest-name suggestions on a miss.

**Grafted from fable:** Playwright-familiar names for factories (`getByText`, `getByRole`, `getByTestId`) and matchers (`toBeVisible`, `toHaveText`, ...). The judge's reason for opus's novel names (`toBeOnScreen`, `toShow`) was the earlier research claim that Playwright reserves those names; a prototype in this repo showed custom matchers under those names work on a non-Locator receiver, so familiarity wins. Also from fable: `Check` as data with a pure `evaluate`, one `retrying` matcher factory, the `relaunch: 'per-test' | 'per-worker'` option with per-test default, the two-state-plus-broken session with `openSession` as sole constructor, automatic reclaim of own-prefix leftover sessions, and actions that wait for their target up to `actionTimeout` instead of failing on the first empty resolution.

**Grafted from sonnet:** the screen listing in the CLI's `[role] "label"` vocabulary so a failure and a manual `agent-device snapshot` read alike, and the `session-rebound` recovery reason kept explicit.

**Rejected from the base:** the read-only lane that bypassed the session mutex. Fact 2 above (every snapshot bumps the generation, pins are valid only for the very next command) means a read between "snapshot" and "press" invalidates the pin, which is exactly the torn-generation case the judge flagged. Everything queues. Also rejected: opus's `", "` label segmentation, because substring matching already covers `getByText('Expo documentation')` against `"Expo documentation, arrow.up.right.square"`, and the cached-screen field on the ready state, because the pipeline captures fresh every time.

**Rejected from sonnet:** thirteen flat `agentDevice*` option fixtures (one namespaced object instead), the eight-variant reducer (no caller observes `opening`, `busy`, or `recovering`), a `Partial<AgentDeviceClientConfig>` escape hatch (leaks the transport type), and its lack of a ready gate.

**Rejected from fable:** restricting `getByText` to text and link roles. Playwright's `getByText` matches any element whose text matches; with ancestor absorption the container case is already handled and the remaining ambiguity (heading vs tab button "Explore") is reported with a list and a `getByRole` hint, which is the Playwright experience.

## Tradeoffs accepted

- A full snapshot per poll tick in exchange for one matching rule the library can explain.
- Serializing reads with mutations in exchange for pinned refs that are always fresh.
- Per-test relaunch by default, a few seconds per test on a dev build, in exchange for tests that never inherit the previous test's screen.
- Familiar matcher names that shadow Playwright's Locator matchers on this package's `expect` only. Web locators are never mixed into the same `expect` here.
- Strictness that fails on genuinely ambiguous locators in exchange for never guessing.
- `hittable` ignored for actionability.

## Open questions

- Should `readyWhen` accept a function for apps with no stable landing text?
- Is a fixed pool keyed on `parallelIndex` the right multi-device model, or should allocation move to `client.leases` once physical devices are in scope?
- Android role table entries are inference until an Android probe runs.

## Verification plan

1. Unit tests (vitest via `vp test`) for `parseScreen`, `resolve`, `evaluate`, `formatFailure` against the JSON captured from the real Home and Explore screens, covering the "Live from the cloud" absorption case, the "Explore" ambiguity case, and the "Home" wrapper case.
2. A `playwright.config.ts` and `e2e/` in `apps/e2e` pointed at that app on a booted simulator with Metro running: home content, a sign-in round trip, absence, and one deliberately failing test to read the message and confirm `screen.png` and `screen.txt` attach.
