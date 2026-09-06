import type { PinnedRef, Platform, RawSnapshot } from "./screen.ts";

export type ScrollDirection = "up" | "down" | "left" | "right";

/**
 * Which device to bind to. A session binds on its first command, so this rides
 * on `open` and on every command after it: a call sent without selection lands
 * on whichever device the daemon picks, which is not necessarily the one under
 * test.
 */
export type DeviceSelection = {
  readonly platform: Platform;
  readonly name: string | null;
};

export type OpenRequest = {
  readonly app: string;
  readonly selection: DeviceSelection;
  readonly session: string;
  readonly relaunch: boolean;
  readonly timeoutMs: number;
};

/**
 * Proof that a device is bound. Only `open` mints one, so "we think we have a
 * device" cannot drift from "we have one".
 */
export type Binding = {
  readonly session: string;
  readonly platform: Platform;
  readonly deviceLabel: string;
  readonly appId: string;
  readonly stateDir: string | null;
};

/** The driver's post-action observation. */
export type Settled = {
  readonly settled: boolean;
  readonly waitedMs: number;
};

/**
 * Why an operation failed, in this library's vocabulary. Translated once, in
 * `driver/agent-device.ts`, so a test author never reads a raw driver code.
 */
export type DeviceFailure =
  | { readonly kind: "device-busy"; readonly owner: string | null; readonly detail: string }
  | { readonly kind: "device-missing"; readonly detail: string }
  | { readonly kind: "app-missing"; readonly detail: string }
  | { readonly kind: "session-rebound"; readonly boundTo: string; readonly detail: string }
  | { readonly kind: "stale-ref"; readonly detail: string }
  | { readonly kind: "ambiguous"; readonly detail: string }
  | { readonly kind: "timeout"; readonly detail: string }
  | {
      readonly kind: "unknown";
      readonly code: string;
      readonly detail: string;
      readonly logPath: string | null;
    };

export type SettleOptions = {
  readonly settleQuietMs: number;
  readonly timeoutMs: number;
};

/**
 * The port between the core and whatever drives a device. Nothing crossing it
 * is a transport type, which is what lets the core be unit-tested against a
 * captured snapshot.
 *
 * Contract every implementation owes the core: `open` converges when called on
 * an already-open session; mutations take a `PinnedRef` and never a selector,
 * so the driver's own matcher is never a second opinion on which node was
 * meant; every failure throws a `DeviceTestError` carrying a `DeviceFailure`.
 */
export type DeviceDriver = {
  open(request: OpenRequest): Promise<Binding>;
  capture(options: { readonly timeoutMs: number }): Promise<RawSnapshot>;
  screenshot(path: string): Promise<string>;
  tap(ref: PinnedRef, options: SettleOptions): Promise<Settled>;
  longPress(ref: PinnedRef, durationMs: number, options: SettleOptions): Promise<Settled>;
  fill(ref: PinnedRef, text: string, options: SettleOptions): Promise<Settled>;
  scroll(direction: ScrollDirection, options: SettleOptions): Promise<Settled>;
  dismissDevOverlay(): Promise<void>;
  /** Ends a session. Names one explicitly so a leftover owned by another run can be reclaimed. */
  close(session: string): Promise<void>;
};
