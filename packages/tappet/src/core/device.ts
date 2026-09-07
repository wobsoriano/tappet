import { describeNode, type Check } from './checks.ts';
import type { ScrollDirection, Settled } from './driver.ts';
import { TappetError } from './errors.ts';
import { probe, type ProbeOptions, type ProbeResult } from './probe.ts';
import { describeQuery, textMatch, type Query, type Role } from './query.ts';
import { renderTitle, type ActionRecord, type ActionSink } from './report.ts';
import {
  pin,
  renderScreen,
  resolve,
  type PinnedRef,
  type Screen,
  type ScreenNode,
} from './screen.ts';
import { failureOf, sleep, type DeviceSession, type SessionDevice } from './session.ts';

const ACTION_POLL_MS = 250;
const DEFAULT_LONG_PRESS_MS = 1000;

/**
 * Per-character typing delay for each fill attempt, in order. A field backed by
 * a controlled component cannot always keep up with input typed as fast as the
 * driver can send it, so a retry paces the keystrokes instead of repeating the
 * call that already failed. Attempts past the end reuse the last entry.
 */
const FILL_DELAYS_MS = [0, 40, 80] as const;

function fillDelayFor(attempt: number): number {
  return FILL_DELAYS_MS[Math.min(attempt, FILL_DELAYS_MS.length - 1)];
}

export type TextOptions = { exact?: boolean };
export type RoleOptions = { name?: string | RegExp; exact?: boolean };
export type ActionOptions = { timeout?: number };

/**
 * What a test holds. One per test, cheap to build, and the only way into the
 * device. Locators are pure values until one of their async methods runs.
 */
export type Device = {
  /** Matches a node's accessibility name or its value, the way Playwright's `getByText` matches text. */
  getByText(text: string | RegExp, options?: TextOptions): Locator;
  getByRole(role: Role, options?: RoleOptions): Locator;
  /** Matches the accessibility identifier, which is what a React Native `testID` becomes. */
  getByTestId(testId: string): Locator;
  /** The escape hatch for anything the three factories cannot express. */
  locator(query: Query): Locator;

  scroll(direction: ScrollDirection): Promise<void>;
  /** Relaunches the app and waits for the ready gate again. */
  relaunch(): Promise<void>;
  /**
   * Clears the React Native development warning overlay. Never automatic: the
   * overlay is a real node and hiding it by default would suppress a warning a
   * test might want to see.
   */
  dismissDevOverlay(): Promise<void>;
  /** The parsed tree, for an assertion this library does not model. */
  screen(): Promise<Screen>;
  /** Saves a screenshot and returns its path. Nothing is attached to the report, so the caller decides whether to. */
  screenshot(options?: { path?: string }): Promise<string>;
};

/**
 * A query bound to a session. Holding one across an action is safe because it
 * stores a query, never a ref.
 */
export type Locator = {
  readonly query: Query;
  /** The factory call this locator renders back to, used in step titles and failure messages. */
  readonly description: string;
  first(): Locator;
  /** Negative indexes count from the end, so `nth(-1)` is the last match. */
  nth(index: number): Locator;
  tap(options?: ActionOptions): Promise<void>;
  fill(text: string, options?: ActionOptions): Promise<void>;
  longPress(durationMs?: number, options?: ActionOptions): Promise<void>;
  count(): Promise<number>;
  /** The matched node's text off one fresh screen. Null when nothing matches; ambiguity fails the way an action does. */
  textContent(): Promise<string | null>;
  /** The retrying assertion primitive every adapter's matchers are built on. */
  expect(check: Check, options: ProbeOptions): Promise<ProbeResult>;
};

export function createDevice(session: DeviceSession, sink: ActionSink): Device {
  const build = (query: Query): Locator => createLocator(session, sink, query);
  let screenshots = 0;
  return {
    getByText: (text, options) => build({ name: textMatch(text, options?.exact) }),
    getByRole: (role, options) =>
      build(
        options?.name === undefined
          ? { role }
          : { role, name: textMatch(options.name, options.exact) },
      ),
    getByTestId: (testId) => build({ testId: textMatch(testId, true) }),
    locator: build,
    scroll: (direction) =>
      sink.step(renderTitle({ kind: 'scroll', direction }), async () => {
        await session.run((device) => device.scroll(direction, session.options.actionTimeout));
      }),
    relaunch: () => session.relaunch(sink),
    dismissDevOverlay: () =>
      sink.step(renderTitle({ kind: 'dismiss-overlay' }), () => session.dismissDevOverlay()),
    screen: () => session.screen(),
    screenshot: (options) => {
      if (options?.path === undefined) screenshots += 1;
      const path = options?.path ?? sink.outputPath(`screenshot-${String(screenshots)}.png`);
      return sink.step(renderTitle({ kind: 'screenshot', path }), () => session.screenshot(path));
    },
  };
}

function createLocator(session: DeviceSession, sink: ActionSink, query: Query): Locator {
  const description = describeQuery(query);
  const withIndex = (index: number): Locator => createLocator(session, sink, { ...query, index });
  return {
    query,
    description,
    first: () => withIndex(0),
    nth: (index) => withIndex(index),
    tap: (options) =>
      perform(session, sink, { kind: 'tap', query }, options, (device, ref, budget) =>
        device.tap(ref, budget),
      ),
    fill: (text, options) =>
      perform(
        session,
        sink,
        { kind: 'fill', query, text },
        options,
        (device, ref, budget, delayMs) => device.fill(ref, text, budget, delayMs),
        text,
      ),
    longPress: (durationMs, options) => {
      const held = durationMs ?? DEFAULT_LONG_PRESS_MS;
      return perform(
        session,
        sink,
        { kind: 'long-press', query, durationMs: held },
        options,
        (device, ref, budget) => device.longPress(ref, held, budget),
      );
    },
    count: async () => {
      const resolution = resolve(await session.screen(), query);
      return resolution.outcome === 'many'
        ? resolution.nodes.length
        : resolution.outcome === 'one'
          ? 1
          : 0;
    },
    textContent: async () => {
      const screen = await session.screen();
      const resolution = resolve(screen, query);
      switch (resolution.outcome) {
        case 'many':
          throw new TappetError({
            kind: 'strict-mode',
            locator: description,
            matches: resolution.nodes.map((node) => describeNode(node)),
            screen: renderScreen(screen),
          });
        case 'none':
          return null;
        case 'one':
          return resolution.node.name ?? resolution.node.value;
        default: {
          const never: never = resolution;
          throw new Error(`unhandled resolution ${JSON.stringify(never)}`);
        }
      }
    },
    expect: (check, options) =>
      probe(
        { query, description, capture: () => session.screen(), failure: () => session.failure() },
        check,
        options,
      ),
  };
}

/**
 * One action is one queued unit and one reported step.
 *
 * Inside the queue: poll a fresh screen until the query resolves to exactly
 * one node, pin that node's ref to the screen it came from, and dispatch. An
 * ambiguous resolution fails at once with the list, because waiting cannot
 * make a locator less ambiguous. A stale-ref rejection re-captures and retries
 * once; a second one means the screen is changing faster than we can act on
 * it, which is a real finding and reported as one.
 *
 * `expectedValue` makes the action a write that is read back. A device keyboard
 * drops early keystrokes often enough that a fill can under-deliver its text
 * and still report success, so fill dispatches again until the field holds what
 * it was given or the budget runs out. Re-filling is safe because a fill
 * replaces the field's contents rather than appending to them.
 *
 * The read back is two reads, not one. Behind a controlled component the field
 * is written twice: once by the driver, then again by the app's own render,
 * which can push a stale string back over what the driver just typed. A single
 * read lands between those writes and reports a value that is already gone, so
 * the second read after the screen has had its quiet period is what proves the
 * value held. Each retry types slower than the last.
 */
function perform(
  session: DeviceSession,
  sink: ActionSink,
  record: Extract<ActionRecord, { query: Query }>,
  options: ActionOptions | undefined,
  dispatch: (
    device: SessionDevice,
    ref: PinnedRef,
    budgetMs: number,
    delayMs: number,
  ) => Promise<Settled>,
  expectedValue?: string,
): Promise<void> {
  const timeout = options?.timeout ?? session.options.actionTimeout;
  const locator = describeQuery(record.query);
  return sink.step(renderTitle(record), async () => {
    await session.run(async (device) => {
      const deadline = Date.now() + timeout;
      let retriedStaleRef = false;
      let attempts = 0;
      const delaysTried: number[] = [];
      let target: Query = record.query;
      let lastActual: string | null = null;
      let screen: Screen = await device.capture();
      const unconfirmed = (): TappetError =>
        new TappetError({
          kind: 'fill-unconfirmed',
          locator,
          expected: expectedValue ?? '',
          actual: lastActual,
          attempts,
          delaysMs: delaysTried,
          timeoutMs: timeout,
          screen: renderScreen(screen),
        });
      for (;;) {
        const resolution = resolve(screen, target);
        if (resolution.outcome === 'many') {
          throw new TappetError({
            kind: 'strict-mode',
            locator,
            matches: resolution.nodes.map((node) => describeNode(node)),
            screen: renderScreen(screen),
          });
        }
        if (resolution.outcome === 'one') {
          // A confirmed write needs its quiet period inside the budget, not whatever is
          // left over. Confirming across a window that shrank to nothing is two reads
          // back to back, which is the single read this exists to replace.
          if (
            expectedValue !== undefined &&
            attempts > 0 &&
            deadline - Date.now() <= session.options.settleQuietMs
          ) {
            throw unconfirmed();
          }
          const delayMs = fillDelayFor(attempts);
          let settled: Settled;
          try {
            settled = await dispatch(
              device,
              pin(screen, resolution.node),
              deadline - Date.now(),
              delayMs,
            );
          } catch (error) {
            if (failureOf(error)?.kind !== 'stale-ref' || retriedStaleRef) throw error;
            retriedStaleRef = true;
            screen = await device.capture();
            continue;
          }
          attempts += 1;
          if (!settled.settled) {
            sink.note('settle', `${renderTitle(record)} finished before the screen went quiet`);
          }
          if (expectedValue === undefined) return;
          delaysTried.push(delayMs);
          // The locator names the field until the first write lands, after which the
          // written node names itself, because Android reports a text field's
          // accessible name as its contents.
          target = identityOf(screen, resolution.node);

          screen = await device.capture();
          lastActual = valueAt(screen, target);
          if (lastActual === expectedValue) {
            await sleep(session.options.settleQuietMs);
            screen = await device.capture();
            const second = valueAt(screen, target);
            // A locator that stopped resolving says nothing about the value, so the read
            // that did resolve stands. Only a different value is evidence of a revert.
            if (second === expectedValue || second === null) return;
            lastActual = second;
          }
          const left = deadline - Date.now();
          if (left <= 0) throw unconfirmed();
          await sleep(Math.min(ACTION_POLL_MS, left));
          screen = await device.capture();
          continue;
        }
        const remaining = deadline - Date.now();
        if (remaining <= 0) {
          throw new TappetError({
            kind: 'not-found',
            locator,
            timeoutMs: timeout,
            screen: renderScreen(screen),
          });
        }
        await sleep(Math.min(ACTION_POLL_MS, remaining));
        screen = await device.capture();
      }
    });
  });
}

/** The field's current contents, or null once the locator stops resolving to exactly one node. */
function valueAt(screen: Screen, target: Query): string | null {
  const found = resolve(screen, target);
  return found.outcome === 'one' ? (found.node.value ?? '') : null;
}

/**
 * How the written node is found again on the next snapshot.
 *
 * A testId is the app's own name for the node, but the driver copies an
 * ancestor's identifier onto every descendant that inherits it, so it names
 * this node alone only when it resolves to this node alone. Two inheriting
 * siblings would otherwise turn a landed fill into a strict-mode failure
 * listing a node the author's locator never matched. Position in the tree is
 * all a snapshot carries once the testId is ambiguous.
 */
function identityOf(screen: Screen, node: ScreenNode): Query {
  if (node.testId !== null) {
    const byTestId: Query = { testId: textMatch(node.testId, true) };
    const resolution = resolve(screen, byTestId);
    if (resolution.outcome === 'one' && resolution.node === node) return byTestId;
  }
  return { where: (other) => other.index === node.index };
}
