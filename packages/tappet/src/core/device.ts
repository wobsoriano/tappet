import { describeNode, type Check } from './checks.ts';
import type { ScrollDirection, Settled } from './driver.ts';
import { TappetError, type ExpectedValue } from './errors.ts';
import { probe, type ProbeOptions, type ProbeResult } from './probe.ts';
import { describeQuery, textMatch, type Filter, type Query, type Role } from './query.ts';
import { renderTitle, type ActionRecord, type ActionSink, type Typed } from './report.ts';
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

export type TextOptions = { exact?: boolean };
export type RoleOptions = { name?: string | RegExp; exact?: boolean };
export type ActionOptions = { timeout?: number };

/**
 * How one `.filter()` call narrows. `hasText` matches the node's own text or
 * any text in its subtree, while `has` means a strict descendant, which is the
 * asymmetry Playwright has. Text follows the default case-insensitive
 * substring rule.
 */
export type FilterOptions = {
  hasText?: string | RegExp;
  hasNotText?: string | RegExp;
  has?: Locator;
  hasNot?: Locator;
};

/**
 * `secret` is fill's alone. It cuts the report and any failure message back to
 * a character count whatever the written node's role, for a field holding a
 * credential the platform did not mark secure, which a snapshot gives no way
 * to detect. The write is still confirmed character for character, because a
 * field the platform left plain hands its exact contents back.
 */
export type FillOptions = ActionOptions & { secret?: boolean };

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
  /** Narrows the matches this locator already makes. Chains, and every call narrows further. */
  filter(options: FilterOptions): Locator;
  tap(options?: ActionOptions): Promise<void>;
  fill(text: string, options?: FillOptions): Promise<void>;
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
    filter: (options) =>
      createLocator(session, sink, {
        ...query,
        filters: [...(query.filters ?? []), filterOf(options)],
      }),
    tap: (options) =>
      perform(session, sink, { kind: 'tap', query }, options, (device, ref, budget) =>
        device.tap(ref, budget),
      ),
    fill: (text, options) =>
      perform(
        session,
        sink,
        { kind: 'fill', query },
        options,
        (device, ref, budget) => device.fill(ref, text, budget),
        { text, secret: options?.secret ?? false },
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

function filterOf(options: FilterOptions): Filter {
  return {
    hasText: options.hasText === undefined ? undefined : textMatch(options.hasText),
    hasNotText: options.hasNotText === undefined ? undefined : textMatch(options.hasNotText),
    has: options.has?.query,
    hasNot: options.hasNot?.query,
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
 * `write` makes the action a write that is read back. A device keyboard
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
 *
 * What counts as proof comes from the written node's role, because a secure
 * field reports a mask rather than its contents and can only ever prove how
 * much it holds. The same classification decides how much of the text the
 * nested `type` step and any failure message are allowed to repeat back. See
 * `confirmationOf`.
 */
function perform(
  session: DeviceSession,
  sink: ActionSink,
  record: Extract<ActionRecord, { query: Query }>,
  options: ActionOptions | undefined,
  dispatch: (device: SessionDevice, ref: PinnedRef, budgetMs: number) => Promise<Settled>,
  write?: Write,
): Promise<void> {
  const timeout = options?.timeout ?? session.options.actionTimeout;
  const locator = describeQuery(record.query);
  return sink.step(renderTitle(record), async () => {
    await session.run(async (device) => {
      const deadline = Date.now() + timeout;
      let retriedStaleRef = false;
      let attempts = 0;
      let target: Query = record.query;
      let lastActual: string | null = null;
      let screen: Screen = await device.capture();
      const unconfirmed = (expected: ExpectedValue): TappetError =>
        new TappetError({
          kind: 'fill-unconfirmed',
          locator,
          expected,
          actual: lastActual === null ? null : disclose(expected, lastActual),
          attempts,
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
          const confirmation =
            write === undefined ? null : confirmationOf(resolution.node.role, write);
          // A confirmed write needs its quiet period inside the budget, not whatever is
          // left over. Confirming across a window that shrank to nothing is two reads
          // back to back, which is the single read this exists to replace.
          if (
            confirmation !== null &&
            attempts > 0 &&
            deadline - Date.now() <= session.options.settleQuietMs
          ) {
            throw unconfirmed(expectedOf(confirmation));
          }
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
          if (confirmation === null) return;
          if (attempts === 1) {
            await sink.step(
              renderTitle({ kind: 'typed', typed: typedOf(confirmation) }),
              () => Promise.resolve(),
              { box: true },
            );
          }
          // The locator names the field until the first write lands, after which the
          // written node names itself, because Android reports a text field's
          // accessible name as its contents.
          target = identityOf(screen, resolution.node);

          screen = await device.capture();
          lastActual = valueAt(screen, target);
          if (lastActual !== null && holds(confirmation, lastActual)) {
            await sleep(session.options.settleQuietMs);
            screen = await device.capture();
            const second = valueAt(screen, target);
            // A locator that stopped resolving says nothing about the value, so the read
            // that did resolve stands. Only a different value is evidence of a revert.
            if (second === null || holds(confirmation, second)) return;
            lastActual = second;
          }
          const left = deadline - Date.now();
          if (left <= 0) throw unconfirmed(expectedOf(confirmation));
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

type Write = { readonly text: string; readonly secret: boolean };

/**
 * What the written field proves about a write, and how much of that a message
 * may repeat back. Both come out of the same question, so they are answered
 * together and cannot drift apart.
 *
 * A secure field never reports its contents, only one masking character per
 * character it holds, so its length is both everything it can attest to and
 * everything it can disclose. Checking that length still catches the failure
 * this confirmation exists for, a device keyboard dropping keystrokes, because
 * a dropped keystroke is a shorter mask.
 *
 * A field the caller marked `secret` is a plain field that happens to hold a
 * credential the platform did not mark secure. It hands back its exact
 * contents, so it is confirmed character for character, and only the reporting
 * is cut back to a length. Folding it into `mask` would compare it the way a
 * mask is compared, which demands one repeated character, and a password read
 * back verbatim is never that.
 */
type Confirmation =
  | { readonly kind: 'mask'; readonly length: number }
  | { readonly kind: 'secret'; readonly value: string }
  | { readonly kind: 'open'; readonly value: string };

function confirmationOf(role: Role, write: Write): Confirmation {
  if (role === 'secure-text-field') return { kind: 'mask', length: write.text.length };
  return write.secret ? { kind: 'secret', value: write.text } : { kind: 'open', value: write.text };
}

function holds(confirmation: Confirmation, actual: string): boolean {
  switch (confirmation.kind) {
    // Requiring the mask be one repeated character is what stops a placeholder that
    // happens to be the right length, which is what an untouched secure field
    // reports, from passing as a landed write.
    case 'mask':
      return actual.length === confirmation.length && new Set(actual).size <= 1;
    case 'secret':
    case 'open':
      return actual === confirmation.value;
    default: {
      const never: never = confirmation;
      throw new Error(`unhandled confirmation ${JSON.stringify(never)}`);
    }
  }
}

function expectedOf(confirmation: Confirmation): ExpectedValue {
  switch (confirmation.kind) {
    case 'mask':
      return { kind: 'masked', length: confirmation.length };
    case 'secret':
      return { kind: 'masked', length: confirmation.value.length };
    case 'open':
      return { kind: 'exact', value: confirmation.value };
    default: {
      const never: never = confirmation;
      throw new Error(`unhandled confirmation ${JSON.stringify(never)}`);
    }
  }
}

function typedOf(confirmation: Confirmation): Typed {
  switch (confirmation.kind) {
    case 'mask':
      return { kind: 'hidden', length: confirmation.length };
    case 'secret':
      return { kind: 'hidden', length: confirmation.value.length };
    case 'open':
      return { kind: 'text', value: confirmation.value };
    default: {
      const never: never = confirmation;
      throw new Error(`unhandled confirmation ${JSON.stringify(never)}`);
    }
  }
}

/**
 * An actual value may be repeated back only as far as the expected one could
 * be, so a field the caller marked secret reports its length the same way a
 * secure field's mask does.
 */
function disclose(expected: ExpectedValue, actual: string): ExpectedValue {
  return expected.kind === 'masked'
    ? { kind: 'masked', length: actual.length }
    : { kind: 'exact', value: actual };
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
