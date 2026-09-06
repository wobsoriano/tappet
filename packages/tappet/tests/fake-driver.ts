import type {
  Binding,
  DeviceDriver,
  DeviceFailure,
  DeviceInfo,
  OpenRequest,
  SettleOptions,
} from '../src/core/driver.ts';
import { TappetError } from '../src/core/errors.ts';
import type { PinnedRef, RawSnapshot } from '../src/core/screen.ts';
import { loadRaw, type FixtureName } from './fixtures.ts';

export type FakeDriver = DeviceDriver & {
  readonly calls: string[];
  /** What `listDevices` reports. */
  devices: DeviceInfo[];
  /** Each entry is consumed by one `open`. A `DeviceFailure` is thrown, anything else succeeds. */
  readonly openOutcomes: DeviceFailure[];
  screens: FixtureName[];
  /** Fails the next N mutations with a stale-ref rejection, the way a superseded generation does. */
  staleRefs: number;
  /**
   * What the next fills actually leave in the field, one entry each. Anything
   * beyond the queue lands whole, so a short queue models a device keyboard
   * that drops keystrokes on the first tries and then behaves.
   */
  readonly fillOutcomes: string[];
  /**
   * Models Android, where a text field reports its contents as its
   * accessibility label as well as its value, so a locator that names the
   * field by its label stops matching once a write lands.
   */
  contentsBecomeLabel: boolean;
};

export function createFakeDriver(options?: { screens?: FixtureName[] }): FakeDriver {
  const calls: string[] = [];
  const openOutcomes: DeviceFailure[] = [];
  const fillOutcomes: string[] = [];
  const written = new Map<string, string>();
  const driver: FakeDriver = {
    calls,
    openOutcomes,
    fillOutcomes,
    screens: options?.screens ?? ['home'],
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
      calls.push(`open ${request.app} relaunch=${String(request.relaunch)}`);
      const failure = openOutcomes.shift();
      if (failure !== undefined)
        return Promise.reject(new TappetError({ kind: 'driver', command: 'open', failure }));
      return Promise.resolve({
        session: 'tappet-ios-0',
        platform: 'ios',
        deviceLabel: 'iPhone 17 Pro Max',
        appId: request.app,
        stateDir: null,
      });
    },

    capture: (): Promise<RawSnapshot> => {
      calls.push('capture');
      const name =
        driver.screens.length > 1
          ? (driver.screens.shift() ?? 'home')
          : (driver.screens[0] ?? 'home');
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
    fill: (ref: PinnedRef, text: string) => {
      calls.push(`fill ${ref} ${text}`);
      written.set(ref.replace(/^@/, '').replace(/~s\d+$/, ''), fillOutcomes.shift() ?? text);
      return mutate(driver);
    },
    scroll: (direction) => {
      calls.push(`scroll ${direction}`);
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
      new TappetError({
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
