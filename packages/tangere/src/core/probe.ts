import { describeCheck, describeNode, evaluate, type Check } from './checks.ts';
import type { DeviceFailure } from './driver.ts';
import { describeFailure } from './errors.ts';
import type { Query } from './query.ts';
import { renderScreen, resolve, type Resolution, type Screen } from './screen.ts';
import { sleep } from './session.ts';

const POLL_INTERVAL_MS = 250;
const SCREEN_LISTING_NODES = 60;

/** What `probe` needs from a locator. A `Locator` supplies it, and so can a fake. */
export type ProbeTarget = {
  readonly query: Query;
  readonly description: string;
  capture(): Promise<Screen>;
  /** The failure that broke the session, or null while it is usable. */
  failure(): DeviceFailure | null;
};

export type ProbeOptions = {
  /** True when the caller wrote `.not`. The loop polls for the opposite condition rather than checking once. */
  readonly negate: boolean;
  readonly timeoutMs: number;
  readonly intervalMs?: number;
};

export type ProbeResult = {
  /**
   * Whether the check holds, always from the un-negated point of view. The
   * adapter hands this to its assertion library, which inverts it for `.not`,
   * so a `.not` that got what it wanted returns `false` here.
   */
  readonly pass: boolean;
  /** Fully rendered, including the screen listing. Empty when the probe passed. */
  readonly message: string;
  readonly actual: string | null;
  readonly expected: string;
};

/**
 * Polls a fresh screen until the check agrees with `negate`, the budget runs
 * out, or the session breaks. Never throws for a failed expectation, because the
 * adapter hands `{ pass, message }` to its assertion library.
 *
 * Every early exit reports `pass: options.negate`, the value that fails the
 * assertion whether or not the caller wrote `.not`. An ambiguous locator and a
 * dead session are wrong under `.not` too, so neither may pass by inversion.
 */
export async function probe(
  target: ProbeTarget,
  check: Check,
  options: ProbeOptions,
): Promise<ProbeResult> {
  const interval = options.intervalMs ?? POLL_INTERVAL_MS;
  const deadline = Date.now() + options.timeoutMs;
  let screen: Screen | null = null;
  let resolution: Resolution = { outcome: 'none', nearest: [] };
  let polls = 0;

  for (;;) {
    const broken = target.failure();
    if (broken !== null) {
      return {
        pass: options.negate,
        message: `Device session is unusable: ${describeFailure(broken)}`,
        actual: null,
        expected: describeCheck(check),
      };
    }
    screen = await target.capture();
    polls += 1;
    resolution = resolve(screen, target.query);
    if (resolution.outcome === 'many' && check.name !== 'toHaveCount') {
      return {
        pass: options.negate,
        actual: `${String(resolution.nodes.length)} matching nodes`,
        expected: describeCheck(check),
        message: formatFailure({
          locator: target.description,
          check,
          negate: options.negate,
          resolution,
          screen,
          timeoutMs: options.timeoutMs,
          polls,
        }),
      };
    }
    const verdict = evaluate(check, resolution);
    if (verdict.pass !== options.negate) {
      return {
        pass: !options.negate,
        message: '',
        actual: verdict.actual,
        expected: describeCheck(check),
      };
    }
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    await sleep(Math.min(interval, remaining));
  }

  const verdict = evaluate(check, resolution);
  return {
    pass: options.negate,
    actual: verdict.actual,
    expected: describeCheck(check),
    message: formatFailure({
      locator: target.description,
      check,
      negate: options.negate,
      resolution,
      screen,
      timeoutMs: options.timeoutMs,
      polls,
    }),
  };
}

/**
 * The screen listing comes from `renderScreen`, the same function that writes
 * `screen.txt`, so terminal and report agree.
 */
export function formatFailure(input: {
  readonly locator: string;
  readonly check: Check;
  readonly negate: boolean;
  readonly resolution: Resolution;
  readonly screen: Screen | null;
  readonly timeoutMs: number;
  readonly polls: number;
}): string {
  const negation = input.negate ? 'not.' : '';
  const lines = [
    `Expected ${negation}${input.check.name} but it never held.`,
    ``,
    `Locator: ${input.locator}`,
    `Expected: ${input.negate ? 'not ' : ''}${describeCheck(input.check)}`,
    `Received: ${received(input.resolution, input.check)}`,
    `Timeout: ${String(input.timeoutMs)}ms (${String(input.polls)} snapshot${input.polls === 1 ? '' : 's'})`,
    ``,
    `Screen:`,
    input.screen === null
      ? '  (no screen captured)'
      : renderScreen(input.screen, { maxNodes: SCREEN_LISTING_NODES }),
    ``,
    `screen.png and screen.txt are attached to this test in the HTML report.`,
  ];
  return lines.join('\n');
}

function received(resolution: Resolution, check: Check): string {
  switch (resolution.outcome) {
    case 'one':
      return evaluate(check, resolution).actual ?? describeNode(resolution.node);
    case 'many':
      return [
        `${String(resolution.nodes.length)} nodes matched, which is ambiguous. Narrow the locator or use .first() / .nth(n).`,
        ...resolution.nodes.map((node) => `  ${describeNode(node)}`),
      ].join('\n');
    case 'none':
      return resolution.nearest.length === 0
        ? 'no node matched'
        : [
            `no node matched. Closest names on screen:`,
            ...resolution.nearest.map((node) => `  ${describeNode(node)}`),
          ].join('\n');
    default: {
      const never: never = resolution;
      throw new Error(`unhandled resolution ${JSON.stringify(never)}`);
    }
  }
}
