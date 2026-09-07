import type {
  Binding,
  CaptureOptions,
  DeviceDriver,
  DeviceFailure,
  DeviceInfo,
  OpenRequest,
  ScrollDirection,
  SettleOptions,
} from '../src/core/driver.ts';
import { TouchpressError } from '../src/core/errors.ts';
import type { ActionSink } from '../src/core/report.ts';
import type { PinnedRef, RawSnapshot } from '../src/core/screen.ts';
import { loadRaw, type FixtureName } from './fixtures.ts';

export type FakeDriver = DeviceDriver & {
  readonly calls: string[];
  devices: DeviceInfo[];
  /** Each entry is consumed by one `open`. A `DeviceFailure` is thrown, anything else succeeds. */
  readonly openOutcomes: DeviceFailure[];
  screens: FixtureName[];
  /** What a `raw: true` capture returns. Consumed like `screens`, and empty means the driver has no raw tree to offer. */
  rawScreens: FixtureName[];
  /**
   * One entry per scroll. A scroll past the end of this queue changes nothing,
   * which is what a container already at its end does.
   */
  onScroll: FixtureName[];
  /** Fails the next N mutations with a stale-ref rejection, the way a superseded generation does. */
  staleRefs: number;
  /**
   * What the next fills leave in the field, one entry each. Anything beyond the
   * queue lands whole, so a short queue models a device keyboard that drops
   * keystrokes on the first tries and then behaves.
   */
  readonly fillOutcomes: string[];
  /**
   * Models a controlled component whose own render writes a stale string back
   * over what the driver typed. The delay is real time, not a capture count, so
   * a read-back that skipped its wait misses the revert.
   */
  revertingFills: number;
  revertAfterMs: number;
  revertTo: string;
  /**
   * Models Android, where a text field reports its contents as its
   * accessibility label as well as its value, so a locator that names the
   * field by its label stops matching once a write lands.
   */
  contentsBecomeLabel: boolean;
};

export function createFakeDriver(options?: {
  screens?: FixtureName[];
  rawScreens?: FixtureName[];
  onScroll?: FixtureName[];
}): FakeDriver {
  const calls: string[] = [];
  const openOutcomes: DeviceFailure[] = [];
  const fillOutcomes: string[] = [];
  const written = new Map<string, string>();
  let pendingRevert: { key: string; value: string; at: number } | null = null;
  const driver: FakeDriver = {
    calls,
    openOutcomes,
    fillOutcomes,
    revertingFills: 0,
    revertAfterMs: 0,
    revertTo: '',
    screens: options?.screens ?? ['home'],
    rawScreens: options?.rawScreens ?? [],
    onScroll: options?.onScroll ?? [],
    staleRefs: 0,
    contentsBecomeLabel: false,
    devices: [
      { id: '2A141E2F-5FD1-4F16-86FB-E9A5835F2166', name: 'iPhone 17 Pro Max', booted: true },
    ],

    listDevices: (): Promise<readonly DeviceInfo[]> => {
      calls.push('listDevices');
      return Promise.resolve(driver.devices);
    },

    open: (request: OpenRequest): Promise<Binding> => {
      const url = request.url === null ? '' : ` url=${request.url}`;
      calls.push(`open ${request.app} relaunch=${String(request.relaunch)}${url}`);
      const failure = openOutcomes.shift();
      if (failure !== undefined)
        return Promise.reject(new TouchpressError({ kind: 'driver', command: 'open', failure }));
      return Promise.resolve({
        session: 'touchpress-ios-0',
        platform: 'ios',
        deviceLabel: 'iPhone 17 Pro Max',
        appId: request.app,
        stateDir: null,
      });
    },

    capture: (options: CaptureOptions): Promise<RawSnapshot> => {
      calls.push(options.tree === 'raw' ? 'capture raw' : 'capture');
      if (pendingRevert !== null && Date.now() >= pendingRevert.at) {
        written.set(pendingRevert.key, pendingRevert.value);
        pendingRevert = null;
      }
      const queue = options.tree === 'raw' ? driver.rawScreens : driver.screens;
      // An empty raw queue is a driver with no raw tree to offer, which is what a
      // platform whose raw capture stops at the window amounts to.
      if (queue.length === 0) return Promise.resolve({ nodes: [] });
      const name = queue.length > 1 ? (queue.shift() ?? 'home') : (queue[0] ?? 'home');
      const raw = loadRaw(name);
      if (written.size === 0) return Promise.resolve(raw);
      return Promise.resolve({
        ...raw,
        nodes: raw.nodes.map((node) => {
          const value = written.get(node.ref);
          if (value === undefined) return node;
          return driver.contentsBecomeLabel ? { ...node, value, label: value } : { ...node, value };
        }),
      });
    },

    screenshot: (path: string): Promise<string> => {
      calls.push(`screenshot ${path}`);
      return Promise.resolve(path);
    },

    tap: (ref: PinnedRef, options: SettleOptions) => {
      calls.push(`tap ${ref} settle=${String(options.timeoutMs)}`);
      return mutate(driver);
    },
    longPress: (ref: PinnedRef, durationMs: number) => {
      calls.push(`longPress ${ref} ${String(durationMs)}`);
      return mutate(driver);
    },
    fill: async (ref: PinnedRef, text: string) => {
      calls.push(`fill ${ref} ${text}`);
      // A rejected fill leaves the field alone, so nothing is written until `mutate` resolves.
      const settled = await mutate(driver);
      const key = ref.replace(/^@/, '').replace(/~s\d+$/, '');
      const landed = fillOutcomes.shift() ?? text;
      written.set(key, landed);
      pendingRevert = null;
      if (driver.revertingFills > 0) {
        driver.revertingFills -= 1;
        pendingRevert = { key, value: driver.revertTo, at: Date.now() + driver.revertAfterMs };
      }
      return settled;
    },
    scroll: (direction: ScrollDirection) => {
      calls.push(`scroll ${direction}`);
      const next = driver.onScroll.shift();
      if (next !== undefined) driver.screens = [next];
      return Promise.resolve();
    },
    dismissDevOverlay: () => {
      calls.push('dismissDevOverlay');
      return Promise.resolve();
    },
    close: (session: string) => {
      calls.push(`close ${session}`);
      return Promise.resolve();
    },
  };
  return driver;
}

function mutate(driver: FakeDriver): Promise<{ settled: boolean; waitedMs: number }> {
  if (driver.staleRefs > 0) {
    driver.staleRefs -= 1;
    return Promise.reject(
      new TouchpressError({
        kind: 'driver',
        command: 'tap',
        failure: {
          kind: 'stale-ref',
          detail: 'Ref was minted from a superseded snapshot generation',
        },
      }),
    );
  }
  return Promise.resolve({ settled: true, waitedMs: 20 });
}

export type RecordedStep = {
  readonly title: string;
  readonly depth: number;
  readonly boxed: boolean;
};

/**
 * The step titles a runner would print, in order, with the nesting a reporter
 * would indent by, so a test asserts on what a terminal and a report hold.
 */
export function createRecordingSink(): ActionSink & { readonly steps: RecordedStep[] } {
  const steps: RecordedStep[] = [];
  let depth = 0;
  return {
    steps,
    step: async <T>(
      title: string,
      body: () => Promise<T>,
      options?: { readonly box?: boolean },
    ) => {
      steps.push({ title, depth, boxed: options?.box === true });
      depth += 1;
      try {
        return await body();
      } finally {
        depth -= 1;
      }
    },
    attach: () => Promise.resolve(),
    note: () => {},
    outputPath: (fileName: string) => fileName,
  };
}
