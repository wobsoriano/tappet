/**
 * The runner-independent surface. An adapter needs exactly this: open a
 * session per worker slot, build an `App` per test over its own `ActionSink`,
 * and turn `Check` names into matchers via `probe`.
 *
 * No module under `core/` imports `@playwright/test` or `agent-device`, and no
 * agent-device type crosses this line. The one exception is this entry's
 * re-export of `preflight`, which needs a concrete driver.
 */

export { createApp } from './app.ts';
export type { ActionOptions, App, Locator, RoleOptions, TextOptions } from './app.ts';

export { describeCheck, evaluate } from './checks.ts';
export type { Check, CheckName, Verdict } from './checks.ts';

export { deviceNameForSlot, parseDeviceOptions, UNCONFIGURED_DEVICE } from './config.ts';
export type { DeviceChoice, DeviceOptions, ReadyQuery, ResolvedOptions } from './config.ts';

export type {
  Binding,
  DeviceDriver,
  DeviceFailure,
  DeviceInfo,
  DeviceSelection,
  OpenRequest,
  ScrollDirection,
  Settled,
} from './driver.ts';

export { TappetError } from './errors.ts';
export type { ErrorInfo } from './errors.ts';

export { captureEvidence } from './evidence.ts';

export { preflight } from '../preflight.ts';
export type { PreflightDevice, PreflightReport } from '../preflight.ts';

export { formatFailure, probe } from './probe.ts';
export type { ProbeOptions, ProbeResult, ProbeTarget } from './probe.ts';

export { describeQuery, normalizeText, textMatch } from './query.ts';
export type { Query, Role, TextMatch } from './query.ts';

export { renderTitle, silentSink } from './report.ts';
export type { ActionRecord, ActionSink, EvidenceFile } from './report.ts';

export { parseScreen, renderScreen, resolve } from './screen.ts';
export type {
  PinnedRef,
  Platform,
  RawSnapshot,
  Rect,
  Resolution,
  Screen,
  ScreenNode,
} from './screen.ts';

export { openSession, sessionName } from './session.ts';
export type { DeviceSession, OpenSessionInput, SessionState } from './session.ts';
