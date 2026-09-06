import type { DeviceFailure } from "./driver.ts";

/**
 * Every failure this library raises is one class with a closed `info` union,
 * so adapters and test authors switch on `info.kind` and the compiler names a
 * missing case when a kind is added.
 */
export type ErrorInfo =
  | { readonly kind: "config"; readonly field: string; readonly detail: string }
  | {
      readonly kind: "device-in-use";
      readonly owner: string | null;
      readonly device: string;
      readonly releaseCommand: string;
      /** False once `onDeviceInUse: 'reclaim'` is already set, so the message stops suggesting it. */
      readonly canReclaim: boolean;
    }
  | {
      readonly kind: "launch-failed";
      readonly app: string;
      readonly device: string;
      readonly failure: DeviceFailure;
    }
  | {
      readonly kind: "not-ready";
      readonly locator: string;
      readonly timeoutMs: number;
      readonly screen: string;
    }
  | { readonly kind: "session-closed"; readonly command: string }
  | {
      readonly kind: "strict-mode";
      readonly locator: string;
      readonly matches: readonly string[];
      readonly screen: string;
    }
  | {
      readonly kind: "not-found";
      readonly locator: string;
      readonly timeoutMs: number;
      readonly screen: string;
    }
  | { readonly kind: "driver"; readonly command: string; readonly failure: DeviceFailure };

export class DeviceTestError extends Error {
  readonly info: ErrorInfo;

  constructor(info: ErrorInfo) {
    super(formatError(info));
    this.name = "DeviceTestError";
    this.info = info;
  }
}

export function formatError(info: ErrorInfo): string {
  switch (info.kind) {
    case "config":
      return `Invalid use.device: ${info.field} ${info.detail}`;
    case "device-in-use":
      return [
        `Device ${info.device} is held by ${info.owner === null ? "another session" : `session "${info.owner}"`}.`,
        `Release it with: ${info.releaseCommand}`,
        ...(info.canReclaim ? ["Or set use.device.onDeviceInUse to 'reclaim'."] : []),
      ].join("\n");
    case "launch-failed":
      return `Could not open ${info.app} on ${info.device}: ${describeFailure(info.failure)}`;
    case "not-ready":
      return [
        `App launched but never became ready.`,
        `Waited ${String(info.timeoutMs)}ms for readyWhen: ${info.locator}`,
        ``,
        `Screen:`,
        info.screen,
      ].join("\n");
    case "session-closed":
      return `Cannot ${info.command}: the device session is closed.`;
    case "strict-mode":
      return [
        `Locator resolved to ${String(info.matches.length)} nodes but an action needs exactly one.`,
        ``,
        `Locator: ${info.locator}`,
        `Matches:`,
        ...info.matches.map((match) => `  ${match}`),
        ``,
        `Narrow it with getByRole, or take one deliberately with .first() or .nth(n).`,
        ``,
        `Screen:`,
        info.screen,
      ].join("\n");
    case "not-found":
      return [
        `Locator never resolved to a node within ${String(info.timeoutMs)}ms.`,
        ``,
        `Locator: ${info.locator}`,
        ``,
        `Screen:`,
        info.screen,
      ].join("\n");
    case "driver":
      return `${info.command} failed: ${describeFailure(info.failure)}`;
    default: {
      const never: never = info;
      throw new Error(`unhandled error info ${JSON.stringify(never)}`);
    }
  }
}

export function describeFailure(failure: DeviceFailure): string {
  switch (failure.kind) {
    case "device-busy":
      return `device is in use${failure.owner === null ? "" : ` by session "${failure.owner}"`} (${failure.detail})`;
    case "device-missing":
      return `no matching device is booted (${failure.detail})`;
    case "app-missing":
      return `the app is not installed on this device (${failure.detail})`;
    case "session-rebound":
      return `the session is already bound to ${failure.boundTo} (${failure.detail})`;
    case "stale-ref":
      return `the screen changed before the action reached it (${failure.detail})`;
    case "ambiguous":
      return `the driver matched more than one element (${failure.detail})`;
    case "timeout":
      return `the driver timed out (${failure.detail})`;
    case "unknown":
      return `${failure.code}: ${failure.detail}${failure.logPath === null ? "" : `\nDiagnostics: ${failure.logPath}`}`;
    default: {
      const never: never = failure;
      throw new Error(`unhandled failure ${JSON.stringify(never)}`);
    }
  }
}
