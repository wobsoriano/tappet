import { describeNode, type Check } from './checks.ts';
import type { ScrollDirection, Settled } from './driver.ts';
import { TappetError } from './errors.ts';
import { probe, type ProbeOptions, type ProbeResult } from './probe.ts';
import { describeQuery, textMatch, type Query, type Role } from './query.ts';
import { renderTitle, type ActionRecord, type ActionSink } from './report.ts';
import { pin, renderScreen, resolve, type PinnedRef, type Screen } from './screen.ts';
import { failureOf, sleep, type DeviceSession, type SessionDevice } from './session.ts';

const ACTION_POLL_MS = 250;
const DEFAULT_LONG_PRESS_MS = 1000;

export type TextOptions = { exact?: boolean };
export type RoleOptions = { name?: string | RegExp; exact?: boolean };
export type ActionOptions = { timeout?: number };

/**
 * What a test holds. One per test, cheap to build, and the only way into the
 * device. Locators are pure values until one of their async methods runs.
 */
export type App = {
  /** Matches a node's accessibility name or its value, the way Playwright's `getByText` matches text. */
  getByText(text: string | RegExp, options?: TextOptions): Locator;
  getByRole(role: Role, options?: RoleOptions): Locator;
  /** Matches the accessibility identifier, which is what a React Native `testID` becomes. */
  getByTestId(testId: string): Locator;
  /** The escape hatch for anything the three factories cannot express. */
  locator(query: Query): Locator;

  scroll(direction: ScrollDirection): Promise<void>;
  /** Relaunches the app and waits for the ready gate again. */
  restart(): Promise<void>;
  /**
   * Clears the React Native development warning overlay. Never automatic: the
   * overlay is a real node and hiding it by default would suppress a warning a
   * test might want to see.
   */
  dismissDevOverlay(): Promise<void>;
  /** The parsed tree, for an assertion this library does not model. */
  screen(): Promise<Screen>;
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
  /** The retrying assertion primitive every adapter's matchers are built on. */
  expect(check: Check, options: ProbeOptions): Promise<ProbeResult>;
};

export function createApp(session: DeviceSession, sink: ActionSink): App {
  const build = (query: Query): Locator => createLocator(session, sink, query);
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
    restart: () => session.relaunch(sink),
    dismissDevOverlay: () =>
      sink.step(renderTitle({ kind: 'dismiss-overlay' }), () => session.dismissDevOverlay()),
    screen: () => session.screen(),
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
        (device, ref, budget) => device.fill(ref, text, budget),
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
 */
function perform(
  session: DeviceSession,
  sink: ActionSink,
  record: Extract<ActionRecord, { query: Query }>,
  options: ActionOptions | undefined,
  dispatch: (device: SessionDevice, ref: PinnedRef, budgetMs: number) => Promise<Settled>,
  expectedValue?: string,
): Promise<void> {
  const timeout = options?.timeout ?? session.options.actionTimeout;
  const locator = describeQuery(record.query);
  return sink.step(renderTitle(record), async () => {
    await session.run(async (device) => {
      const deadline = Date.now() + timeout;
      let retriedStaleRef = false;
      let attempts = 0;
      let screen: Screen = await device.capture();
      for (;;) {
        const resolution = resolve(screen, record.query);
        if (resolution.outcome === 'many') {
          throw new TappetError({
            kind: 'strict-mode',
            locator,
            matches: resolution.nodes.map((node) => describeNode(node)),
            screen: renderScreen(screen),
          });
        }
        if (resolution.outcome === 'one') {
          let settled: Settled;
          try {
            settled = await dispatch(device, pin(screen, resolution.node), deadline - Date.now());
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

          screen = await device.capture();
          const written = resolve(screen, record.query);
          const actual = written.outcome === 'one' ? (written.node.value ?? '') : null;
          if (actual === expectedValue) return;
          const left = deadline - Date.now();
          if (left <= 0) {
            throw new TappetError({
              kind: 'fill-unconfirmed',
              locator,
              expected: expectedValue,
              actual,
              attempts,
              timeoutMs: timeout,
              screen: renderScreen(screen),
            });
          }
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
