import { deviceNameForSlot, sessionName, type ResolvedOptions } from "./config.ts";
import type {
  Binding,
  DeviceDriver,
  DeviceFailure,
  DeviceSelection,
  ScrollDirection,
  Settled,
} from "./driver.ts";
import { DeviceTestError } from "./errors.ts";
import { describeQuery } from "./query.ts";
import { renderTitle, type ActionSink } from "./report.ts";
import { parseScreen, renderScreen, resolve, type PinnedRef, type Screen } from "./screen.ts";

const READY_POLL_MS = 250;
const SNAPSHOT_TIMEOUT_MS = 15_000;

/**
 * There is no unopened or opening variant because `openSession` is the only
 * constructor and it returns after `open` succeeded and the ready gate passed.
 * `broken` carries the first failure so a later call reports the root cause
 * rather than a follow-on symptom.
 */
export type SessionState =
  | { readonly phase: "ready"; readonly binding: Binding }
  | { readonly phase: "closed"; readonly reason: "requested" | "worker-exit" }
  | { readonly phase: "broken"; readonly failure: DeviceFailure };

/**
 * Serializes every command on one session, reads included.
 *
 * Reads could run in parallel per the driver's own rule, but a read between a
 * snapshot and the action pinned to it advances the ref generation and
 * invalidates the pin. One queue is what makes "snapshot, resolve, pin, act"
 * atomic.
 */
export type Queue = {
  enqueue<T>(body: () => Promise<T>): Promise<T>;
};

export function createQueue(): Queue {
  let tail: Promise<unknown> = Promise.resolve();
  return {
    enqueue<T>(body: () => Promise<T>): Promise<T> {
      // The tail advances whether `body` settled or rejected, so one failed command never wedges the queue.
      const next = tail.then(body, body);
      tail = next.catch(() => undefined);
      return next;
    },
  };
}

/** The device capabilities available inside one queued unit. Settle options come from the session's config. */
export type SessionDevice = {
  capture(): Promise<Screen>;
  tap(ref: PinnedRef): Promise<Settled>;
  longPress(ref: PinnedRef, durationMs: number): Promise<Settled>;
  fill(ref: PinnedRef, text: string): Promise<Settled>;
  scroll(direction: ScrollDirection): Promise<void>;
};

export type DeviceSession = {
  readonly name: string;
  readonly options: ResolvedOptions;
  readonly binding: Binding;
  state(): SessionState;
  /** The failure that broke this session, or null while it is usable. */
  failure(): DeviceFailure | null;
  /** Runs `body` as one unit on the session's queue. Nothing else touches the device while it runs. */
  run<T>(body: (device: SessionDevice) => Promise<T>): Promise<T>;
  screen(): Promise<Screen>;
  screenshot(path: string): Promise<string>;
  /** Relaunches the app and re-runs the ready gate. Reported as one step. */
  relaunch(sink: ActionSink): Promise<void>;
  dismissDevOverlay(): Promise<void>;
  awaitReady(deadline: number): Promise<void>;
  /** Idempotent. Never shuts the simulator down, and reaches `closed` even when the driver call fails. */
  close(reason: "requested" | "worker-exit"): Promise<void>;
};

export type OpenSessionInput = {
  readonly options: ResolvedOptions;
  /** The runner's stable worker slot. Playwright passes `parallelIndex`, which a replacement worker reuses. */
  readonly slot: number;
  /** The runner's project name. Part of the session name so two projects never share one. */
  readonly scope: string;
  readonly sink: ActionSink;
  readonly createDriver: (session: string, selection: DeviceSelection) => DeviceDriver;
};

/**
 * Convergent startup. Running it twice settles on one ready session.
 *
 * In order: reclaim a leftover session of our own name, open with the
 * selection carried on that first command, recover once from a device claimed
 * by a leftover of ours or under `onDeviceInUse: 'reclaim'`, recover once from
 * a session bound to another device, then hold until `readyWhen` resolves
 * because `open` returns while the JavaScript bundle is still loading.
 */
export async function openSession(input: OpenSessionInput): Promise<DeviceSession> {
  const { options, sink } = input;
  const name = sessionName(options, input.scope, input.slot);
  const deviceName = deviceNameForSlot(options, input.slot);
  const driver = input.createDriver(name, { platform: options.platform, name: deviceName });
  const deadline = Date.now() + options.launchTimeout;

  await driver.close(name);
  const binding = await openWithRecovery(driver, options, name, deviceName);
  sink.note("device", `${binding.deviceLabel} (${binding.platform}) session ${binding.session}`);

  const session = createSession(driver, options, name, binding);
  await sink.step(
    renderTitle({ kind: "open", app: options.app, device: binding.deviceLabel, session: name }),
    async () => {
      if (options.dismissDevOverlay) await session.dismissDevOverlay();
      await session.awaitReady(deadline);
    },
  );
  return session;
}

async function openWithRecovery(
  driver: DeviceDriver,
  options: ResolvedOptions,
  name: string,
  deviceName: string | null,
): Promise<Binding> {
  const request = { app: options.app, relaunch: true };
  try {
    return await driver.open(request);
  } catch (error) {
    const failure = failureOf(error);
    if (failure === null) throw error;
    if (failure.kind === "device-busy") {
      const owner = failure.owner;
      const reclaimable =
        owner !== null &&
        (owner.startsWith(options.sessionPrefix) || options.onDeviceInUse === "reclaim");
      if (!reclaimable) {
        throw new DeviceTestError({
          kind: "device-in-use",
          owner,
          device: deviceName ?? options.platform,
          releaseCommand: `agent-device close --session ${owner ?? "<owner>"}`,
        });
      }
      await driver.close(owner);
      return await driver.open(request);
    }
    if (failure.kind === "session-rebound") {
      await driver.close(name);
      return await driver.open(request);
    }
    throw new DeviceTestError({
      kind: "launch-failed",
      app: options.app,
      device: deviceName ?? options.platform,
      failure,
    });
  }
}

function createSession(
  driver: DeviceDriver,
  options: ResolvedOptions,
  name: string,
  binding: Binding,
): DeviceSession {
  const queue = createQueue();
  const settle = { settleQuietMs: options.settleQuietMs, timeoutMs: options.actionTimeout };
  let state: SessionState = { phase: "ready", binding };

  const device: SessionDevice = {
    capture: async () =>
      parseScreen(await driver.capture({ timeoutMs: SNAPSHOT_TIMEOUT_MS }), options.platform),
    tap: (ref) => driver.tap(ref, settle),
    longPress: (ref, durationMs) => driver.longPress(ref, durationMs, settle),
    fill: (ref, text) => driver.fill(ref, text, settle),
    scroll: (direction) => driver.scroll(direction, settle),
  };

  function run<T>(body: (device: SessionDevice) => Promise<T>): Promise<T> {
    return queue.enqueue(async () => {
      if (state.phase !== "ready") throw unusable(state);
      try {
        return await body(device);
      } catch (error) {
        const failure = failureOf(error);
        if (failure !== null && breaksTheSession(failure)) state = { phase: "broken", failure };
        throw error;
      }
    });
  }

  async function awaitReady(deadline: number): Promise<void> {
    let screen: Screen;
    for (;;) {
      screen = await run((one) => one.capture());
      if (resolve(screen, options.readyWhen).outcome === "one") return;
      if (Date.now() + READY_POLL_MS >= deadline) break;
      await sleep(READY_POLL_MS);
    }
    throw new DeviceTestError({
      kind: "not-ready",
      locator: describeQuery(options.readyWhen),
      timeoutMs: options.launchTimeout,
      screen: renderScreen(screen),
    });
  }

  return {
    name,
    options,
    binding,
    state: () => state,
    failure: () => (state.phase === "broken" ? state.failure : null),
    run,
    screen: () => run((one) => one.capture()),
    screenshot: (path) => queue.enqueue(() => driver.screenshot(path)),
    relaunch: (sink) =>
      sink.step(renderTitle({ kind: "restart", app: options.app }), async () => {
        // Relaunching with the session's own selection is what keeps `open` legal on an already-bound session.
        await run(() => driver.open({ app: options.app, relaunch: true }));
        if (options.dismissDevOverlay) await run(() => driver.dismissDevOverlay());
        await awaitReady(Date.now() + options.launchTimeout);
      }),
    dismissDevOverlay: () => run(() => driver.dismissDevOverlay()),
    awaitReady,
    close: async (reason) => {
      if (state.phase === "closed") return;
      try {
        await driver.close(name);
      } finally {
        state = { phase: "closed", reason };
      }
    },
  };
}

function unusable(state: SessionState): DeviceTestError {
  if (state.phase === "broken")
    return new DeviceTestError({
      kind: "driver",
      command: "device command",
      failure: state.failure,
    });
  return new DeviceTestError({ kind: "session-closed", command: "run a device command" });
}

/**
 * Only a failure meaning the device or the session itself is gone breaks the
 * session. A stale ref, an ambiguous match, or one timed-out command is a
 * per-command outcome the caller recovers from.
 */
function breaksTheSession(failure: DeviceFailure): boolean {
  return (
    failure.kind === "device-busy" ||
    failure.kind === "device-missing" ||
    failure.kind === "session-rebound"
  );
}

export function failureOf(error: unknown): DeviceFailure | null {
  if (!(error instanceof DeviceTestError)) return null;
  if (error.info.kind === "driver") return error.info.failure;
  if (error.info.kind === "launch-failed") return error.info.failure;
  return null;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((done) => setTimeout(done, ms));
}
