import { test as runner, type ExpectMatcherState, type TestInfo } from '@playwright/test';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Device, Locator } from '../core/device.ts';
import type { Query } from '../core/query.ts';
import { resolve, type Screen } from '../core/screen.ts';
import {
  compareScreenshot,
  cropScreenshot,
  relativeTo,
  sizeOf,
  toPixelBox,
  type Comparison,
  type PixelBox,
} from '../core/screenshot.ts';
import type { ActionSink } from '../core/report.ts';
import { sleep } from '../core/session.ts';
import { playwrightSink } from './fixtures.ts';

const POLL_INTERVAL_MS = 250;
const DEFAULT_MAX_DIFF_PIXEL_RATIO = 0.01;
const DEFAULT_THRESHOLD = 0.2;

export type ScreenshotOptions = {
  timeout?: number;
  /** The share of the image allowed to differ. @default 0.01 */
  maxDiffPixelRatio?: number;
  /** pixelmatch's per-pixel colour distance, 0 to 1. Smaller is stricter. @default 0.2 */
  threshold?: number;
  /** Painted opaque black in both images, for anything that legitimately changes between runs. */
  mask?: Locator[];
};

type MatcherResult = {
  pass: boolean;
  message: () => string;
  name: string;
  expected: string;
  actual: string | null;
};

/** A locator that is not on screen yet is retried, the way every other matcher retries. */
type Attempt =
  | { readonly kind: 'unresolved'; readonly detail: string }
  | { readonly kind: 'captured'; readonly png: Buffer; readonly mask: readonly PixelBox[] };

/**
 * Numbers an unnamed screenshot per test, so two assertions in one test do not
 * write over each other's baseline. A retried test gets a fresh `TestInfo`, so
 * the numbering starts again and the same run reproduces the same paths.
 */
const ordinals = new WeakMap<TestInfo, number>();

/**
 * The baseline path comes from `testInfo.snapshotPath`, so
 * `snapshotPathTemplate`, the per-project suffix and `--update-snapshots` behave
 * the way they do for Playwright's own screenshot assertion.
 *
 * A locator's crop and every mask are resolved off one snapshot taken next to
 * the image. Rects from two snapshots would index into the image at two
 * different scroll positions, which crops the wrong thing rather than failing.
 */
export async function assertScreenshot(
  state: ExpectMatcherState,
  target: Device | Locator,
  nameOrOptions: string | ScreenshotOptions | undefined,
  extra: ScreenshotOptions | undefined,
): Promise<MatcherResult> {
  const options = (typeof nameOrOptions === 'string' ? extra : nameOrOptions) ?? {};
  const info = runner.info();
  const sink = playwrightSink();
  const timeout = options.timeout ?? state.timeout;
  const maxDiffPixelRatio = options.maxDiffPixelRatio ?? DEFAULT_MAX_DIFF_PIXEL_RATIO;
  const expected = `${state.isNot ? 'not ' : ''}at most ${percent(maxDiffPixelRatio)} of pixels to differ`;
  const label = 'query' in target ? target.description : 'the whole device';
  const baseline = info.snapshotPath(
    typeof nameOrOptions === 'string' ? nameOrOptions : defaultName(info),
    { kind: 'screenshot' },
  );
  const update = info.config.updateSnapshots;
  const deadline = Date.now() + timeout;

  let captures = 0;
  let attempt = await capture(target, info, options.mask ?? []);
  for (;;) {
    captures += 1;
    if (attempt.kind === 'captured') {
      if (!existsSync(baseline)) {
        return missingBaseline(state, { expected, label, baseline, update, png: attempt.png });
      }
      const comparison = compareScreenshot(readFileSync(baseline), attempt.png, {
        threshold: options.threshold ?? DEFAULT_THRESHOLD,
        maxDiffPixelRatio,
        mask: attempt.mask,
      });
      const matched = comparison.kind === 'match';
      if (matched !== state.isNot) {
        return {
          pass: matched,
          name: 'toHaveScreenshot',
          expected,
          actual: received(comparison),
          message: () => '',
        };
      }
      if (!state.isNot && (update === 'all' || update === 'changed')) {
        write(baseline, attempt.png);
        return {
          pass: true,
          name: 'toHaveScreenshot',
          expected,
          actual: received(comparison),
          message: () => '',
        };
      }
      if (Date.now() >= deadline) {
        await attachAll(sink, baseline, attempt.png, comparison);
        return fail(state, expected, received(comparison), [
          `Expected ${state.isNot ? 'not.' : ''}toHaveScreenshot but it never ${state.isNot ? 'differed' : 'matched'}.`,
          ``,
          `Target: ${label}`,
          `Baseline: ${baseline}`,
          `Expected: ${expected}`,
          `Received: ${received(comparison)}`,
          timeoutLine(timeout, captures),
          ``,
          `expected.png, actual.png and diff.png are attached to this test in the HTML report.`,
        ]);
      }
    } else if (Date.now() >= deadline) {
      return fail(state, expected, null, [
        `Expected ${state.isNot ? 'not.' : ''}toHaveScreenshot but the locator never resolved.`,
        ``,
        `Target: ${label}`,
        `Received: ${attempt.detail}`,
        timeoutLine(timeout, captures),
      ]);
    }
    await sleep(Math.min(POLL_INTERVAL_MS, deadline - Date.now()));
    attempt = await capture(target, info, options.mask ?? []);
  }
}

/**
 * The scale is derived rather than asked for. A tree reports rects in whatever
 * units its platform uses, so the image width over the widest rect on screen,
 * which is the window, is what one unit is worth in pixels. It comes out at 1 on
 * both devices this is tested against, because agent-device writes the iOS
 * simulator's image at point resolution and the Android tree already reports
 * pixels. Deriving it keeps a device writing a 2x or 3x image from cropping the
 * wrong region.
 */
async function capture(
  target: Device | Locator,
  info: TestInfo,
  masks: readonly Locator[],
): Promise<Attempt> {
  const device = 'query' in target ? target.device : target;
  const screen = await device.screen();
  const path = await device.screenshot({ path: info.outputPath(`toHaveScreenshot-actual.png`) });
  const full = readFileSync(path);
  const scale = scaleOf(screen, sizeOf(full).width);

  const region = 'query' in target ? regionOf(screen, target.query, scale) : null;
  if (typeof region === 'string') return { kind: 'unresolved', detail: region };

  const boxes = masks.flatMap((mask) => boxesOf(screen, mask.query, scale));
  if (region === null) return { kind: 'captured', png: full, mask: boxes };
  return {
    kind: 'captured',
    png: cropScreenshot(full, region),
    mask: boxes.map((box) => relativeTo(box, region)),
  };
}

/** The crop for a locator, or why it could not be taken. */
function regionOf(screen: Screen, query: Query, scale: number): PixelBox | string {
  const resolution = resolve(screen, query);
  switch (resolution.outcome) {
    case 'none':
      return 'no node matched';
    case 'many':
      return `${String(resolution.nodes.length)} nodes matched, which is ambiguous. Narrow the locator or use .first() / .nth(n).`;
    case 'one': {
      const rect = resolution.node.rect;
      if (rect === null)
        return `${resolution.node.ref} reports no rect, so there is nothing to crop`;
      return toPixelBox(rect, scale);
    }
    default: {
      const never: never = resolution;
      throw new Error(`unhandled resolution ${JSON.stringify(never)}`);
    }
  }
}

/** A mask hides a region rather than picking one node, so ambiguity is not an error here. */
function boxesOf(screen: Screen, query: Query, scale: number): PixelBox[] {
  const resolution = resolve(screen, query);
  const nodes =
    resolution.outcome === 'one'
      ? [resolution.node]
      : resolution.outcome === 'many'
        ? resolution.nodes
        : [];
  return nodes.flatMap((node) => (node.rect === null ? [] : [toPixelBox(node.rect, scale)]));
}

function scaleOf(screen: Screen, imageWidth: number): number {
  const widest = Math.max(0, ...screen.nodes.map((node) => node.rect?.width ?? 0));
  return widest > 0 ? imageWidth / widest : 1;
}

function missingBaseline(
  state: ExpectMatcherState,
  input: {
    readonly expected: string;
    readonly label: string;
    readonly baseline: string;
    readonly update: TestInfo['config']['updateSnapshots'];
    readonly png: Buffer;
  },
): MatcherResult {
  if (state.isNot) {
    return fail(state, input.expected, null, [
      `Expected not.toHaveScreenshot, but there is no baseline to differ from.`,
      ``,
      `Target: ${input.label}`,
      `Baseline: ${input.baseline}`,
      ``,
      `Write one with a passing toHaveScreenshot first.`,
    ]);
  }
  write(input.baseline, input.png);
  if (input.update === 'all' || input.update === 'missing') {
    return {
      pass: true,
      name: 'toHaveScreenshot',
      expected: input.expected,
      actual: null,
      message: () => '',
    };
  }
  return fail(state, input.expected, null, [
    `A snapshot doesn't exist at ${input.baseline}, writing actual.`,
  ]);
}

async function attachAll(
  sink: ActionSink,
  baseline: string,
  actual: Buffer,
  comparison: Comparison,
): Promise<void> {
  await sink.attach({ name: 'expected.png', path: baseline, contentType: 'image/png' });
  const actualPath = sink.outputPath('actual.png');
  writeFileSync(actualPath, actual);
  await sink.attach({ name: 'actual.png', path: actualPath, contentType: 'image/png' });
  if (comparison.kind !== 'mismatch') return;
  const diffPath = sink.outputPath('diff.png');
  writeFileSync(diffPath, comparison.diff);
  await sink.attach({ name: 'diff.png', path: diffPath, contentType: 'image/png' });
}

function received(comparison: Comparison): string {
  switch (comparison.kind) {
    case 'match':
    case 'mismatch':
      return `${percent(comparison.ratio)} of pixels differ`;
    case 'size-mismatch':
      return `the screenshot is ${size(comparison.actual)} and the baseline is ${size(comparison.expected)}`;
    default: {
      const never: never = comparison;
      throw new Error(`unhandled comparison ${JSON.stringify(never)}`);
    }
  }
}

function size(value: { readonly width: number; readonly height: number }): string {
  return `${String(value.width)}x${String(value.height)}`;
}

function percent(ratio: number): string {
  const shown = ratio * 100;
  return `${shown < 0.1 && shown > 0 ? shown.toFixed(3) : String(Math.round(shown * 100) / 100)}%`;
}

function timeoutLine(timeout: number, captures: number): string {
  return `Timeout: ${String(timeout)}ms (${String(captures)} capture${captures === 1 ? '' : 's'})`;
}

function fail(
  state: ExpectMatcherState,
  expected: string,
  actual: string | null,
  lines: readonly string[],
): MatcherResult {
  // The value that fails the assertion whether or not the caller wrote `.not`, the way `probe` reports one.
  return {
    pass: state.isNot,
    name: 'toHaveScreenshot',
    expected,
    actual,
    message: () => lines.join('\n'),
  };
}

function write(path: string, png: Buffer): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, png);
}

function defaultName(info: TestInfo): string {
  const next = (ordinals.get(info) ?? 0) + 1;
  ordinals.set(info, next);
  const slug = info.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return `${slug}-${String(next)}.png`;
}
