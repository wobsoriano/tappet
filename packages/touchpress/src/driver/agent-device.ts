import { createAgentDeviceClient, normalizeAgentDeviceError } from 'agent-device';
import type {
  Binding,
  DeviceDriver,
  DeviceFailure,
  DeviceInfo,
  DeviceSelection,
  OpenRequest,
  ScrollDirection,
  Settled,
  SettleOptions,
} from '../core/driver.ts';
import { TouchpressError } from '../core/errors.ts';
import type { PinnedRef, RawSnapshot } from '../core/screen.ts';

/** agent-device's root entry exports values only, so the client type is derived here and nowhere else. */
type Client = ReturnType<typeof createAgentDeviceClient>;

/** `full` is explicit because a digest-level response omits `nodes`, and the whole library matches on nodes. */
export function createClient(): Client {
  return createAgentDeviceClient({ responseLevel: 'full' });
}

/**
 * The only file that imports `agent-device`. Two jobs: translate domain requests
 * into client calls carrying the session and device selection, and translate the
 * driver's error codes into `DeviceFailure`. Snapshot parsing is not one of
 * them, because role normalization and label rules live in `core/screen.ts`.
 */
export function createAgentDeviceDriver(
  client: Client,
  session: string,
  selection: DeviceSelection,
): DeviceDriver {
  const where = {
    session,
    platform: selection.platform,
    ...(selection.name === null ? {} : { device: selection.name }),
  };

  async function run<T>(command: string, body: () => Promise<T>): Promise<T> {
    try {
      return await body();
    } catch (error) {
      throw new TouchpressError({ kind: 'driver', command, failure: classifyError(error) });
    }
  }

  return {
    listDevices: (): Promise<readonly DeviceInfo[]> =>
      run('listDevices', async () => {
        // Only the platform crosses: naming the session here would bind it, and preflight must bind nothing.
        const devices = await client.devices.list({ platform: selection.platform });
        return devices.map((device) => ({
          id: device.id,
          name: device.name,
          booted: device.booted ?? false,
        }));
      }),

    open: (request: OpenRequest): Promise<Binding> =>
      run('open', async () => {
        const result = await client.apps.open({
          ...where,
          app: request.app,
          relaunch: request.relaunch,
          ...(request.url === null ? {} : { url: request.url }),
        });
        return {
          session: result.session,
          platform: selection.platform,
          deviceLabel:
            result.device?.name ??
            result.identifiers.deviceName ??
            selection.name ??
            selection.platform,
          appId: result.appBundleId ?? result.appId ?? request.app,
          stateDir: result.sessionStateDir ?? null,
        };
      }),

    capture: (options): Promise<RawSnapshot> =>
      run('snapshot', () =>
        client.capture.snapshot({
          ...where,
          forceFull: true,
          raw: options.tree === 'raw',
          timeoutMs: options.timeoutMs,
        }),
      ),

    screenshot: (path: string): Promise<string> =>
      run('screenshot', async () => (await client.capture.screenshot({ ...where, path })).path),

    tap: (ref: PinnedRef, options: SettleOptions): Promise<Settled> =>
      run('tap', async () =>
        toSettled(await client.interactions.press({ ...where, ref, ...settle(options) })),
      ),

    longPress: (ref: PinnedRef, durationMs: number, options: SettleOptions): Promise<Settled> =>
      run('longPress', async () =>
        toSettled(
          await client.interactions.longPress({ ...where, ref, durationMs, ...settle(options) }),
        ),
      ),

    fill: (ref: PinnedRef, text: string, options: SettleOptions): Promise<Settled> =>
      run('fill', async () =>
        toSettled(await client.interactions.fill({ ...where, ref, text, ...settle(options) })),
      ),

    scroll: (direction: ScrollDirection, options: SettleOptions): Promise<void> =>
      run('scroll', async () => {
        await client.interactions.scroll({ ...where, direction, ...settle(options) });
      }),

    dismissDevOverlay: (): Promise<void> =>
      run('dismissDevOverlay', async () => {
        await client.command.reactNative({ ...where, action: 'dismiss-overlay' });
      }),

    close: (target: string): Promise<void> =>
      run('close', async () => {
        try {
          await client.sessions.close({ session: target });
        } catch (error) {
          // Closing a session that is already gone is the desired end state.
          if (readNormalized(error).code !== 'SESSION_NOT_FOUND') throw error;
        }
      }),
  };
}

function settle(options: SettleOptions): {
  settle: true;
  settleQuietMs: number;
  timeoutMs: number;
} {
  return { settle: true, settleQuietMs: options.settleQuietMs, timeoutMs: options.timeoutMs };
}

/** `settle` is best-effort upstream and never fails an action, so an absent observation is not an error. */
function toSettled(result: { settle?: { settled: boolean; waitedMs: number } }): Settled {
  return { settled: result.settle?.settled ?? false, waitedMs: result.settle?.waitedMs ?? 0 };
}

function readNormalized(error: unknown): {
  code: string;
  message: string;
  logPath?: string;
  details?: Record<string, unknown>;
} {
  return normalizeAgentDeviceError(error);
}

/**
 * Timeouts and transport faults both arrive as `COMMAND_FAILED`, so the message
 * and `details.reason` separate them. That matches against upstream text, and it
 * is confined to this function for exactly that reason.
 */
export function classifyError(error: unknown): DeviceFailure {
  const normalized = readNormalized(error);
  const { code, message } = normalized;
  const details = normalized.details ?? {};
  const logPath = normalized.logPath ?? null;

  switch (code) {
    case 'DEVICE_IN_USE':
      return { kind: 'device-busy', owner: ownerOf(details, message), detail: message };
    case 'DEVICE_NOT_FOUND':
      return { kind: 'device-missing', detail: message };
    case 'APP_NOT_INSTALLED':
      return { kind: 'app-missing', detail: message };
    case 'AMBIGUOUS_MATCH':
      return { kind: 'ambiguous', detail: message };
    case 'INVALID_ARGS': {
      const bound = /bound to (.+?)(?:[.]|$)/i.exec(message);
      if (bound !== null)
        return { kind: 'session-rebound', boundTo: bound[1] ?? message, detail: message };
      return { kind: 'unknown', code, detail: message, logPath };
    }
    case 'COMMAND_FAILED':
      if (details['reason'] === 'ref_generation_mismatch')
        return { kind: 'stale-ref', detail: message };
      if (/timed out|timeout/i.test(message)) return { kind: 'timeout', detail: message };
      return { kind: 'unknown', code, detail: message, logPath };
    default:
      return { kind: 'unknown', code, detail: message, logPath };
  }
}

/**
 * A device claim made in another workspace does not appear in a session listing
 * run from here, so the owning session name in the error is the only way to name
 * it. It arrives in `details` on some paths and only in the message text
 * (`by session "lex"`) on others.
 */
function ownerOf(details: Record<string, unknown>, message: string): string | null {
  for (const key of ['session', 'owner', 'ownerSession']) {
    const value = details[key];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  const quoted = /by session "([^"]+)"/.exec(message);
  return quoted?.[1] ?? null;
}
