import { DeviceTestError } from "./errors.ts";
import { textMatch, type Query, type Role } from "./query.ts";
import type { Platform } from "./screen.ts";

/**
 * The one object a test author writes in `use.device`. Parsed once by
 * `parseDeviceOptions` at worker start; nothing downstream re-validates it.
 */
export type DeviceOptions = {
  platform: Platform;
  /** Bundle id on iOS, package name on Android. Never a path to an artifact. */
  app: string;
  /**
   * The locator that means the JavaScript bundle finished loading. Required,
   * because `open` returns as soon as the native process launches and the
   * first assertion would otherwise race the bundle.
   */
  readyWhen: ReadyQuery;
  /** Device name. An array is a pool indexed by the runner's worker slot. Omitted means the first booted device. */
  name?: string | readonly string[];
  /** @default 'per-test' */
  relaunch?: "per-test" | "per-worker";
  /** @default 'fail'. Sessions carrying this library's own prefix are always reclaimed. */
  onDeviceInUse?: "fail" | "reclaim";
  /** @default 10_000 */
  actionTimeout?: number;
  /** @default 500 */
  settleQuietMs?: number;
  /** @default 90_000. Covers `open` plus the ready gate. */
  launchTimeout?: number;
  /** @default false. Sends agent-device's `react-native dismiss-overlay` after every launch. */
  dismissDevOverlay?: boolean;
  /** @default 'on-failure' */
  evidence?: "on-failure" | "always" | "off";
  /** @default 'pwad'. Session names are `${prefix}-${project}-${parallelIndex}`. */
  sessionPrefix?: string;
};

/** The config-file friendly subset of a locator. Matched by the same rules as any other query. */
export type ReadyQuery =
  | { text: string; exact?: boolean }
  | { testId: string }
  | { role: Role; name?: string };

/** Every optional field resolved. Constructed only by `parseDeviceOptions`, so internal code trusts it. */
export type ResolvedOptions = {
  readonly platform: Platform;
  readonly app: string;
  readonly readyWhen: Query;
  readonly names: readonly string[];
  readonly relaunch: "per-test" | "per-worker";
  readonly onDeviceInUse: "fail" | "reclaim";
  readonly actionTimeout: number;
  readonly settleQuietMs: number;
  readonly launchTimeout: number;
  readonly dismissDevOverlay: boolean;
  readonly evidence: "on-failure" | "always" | "off";
  readonly sessionPrefix: string;
};

/**
 * The Playwright option fixture needs a default of the declared type, and this
 * is it. `parseDeviceOptions` rejects it by its empty `app`, which is the same
 * error a config that forgot the field would get.
 */
export const UNCONFIGURED_DEVICE: DeviceOptions = {
  platform: "ios",
  app: "",
  readyWhen: { text: "" },
};

const ROLES: readonly Role[] = [
  "application",
  "window",
  "button",
  "text",
  "text-field",
  "secure-text-field",
  "link",
  "image",
  "switch",
  "slider",
  "tab-bar",
  "scroll-area",
  "cell",
  "alert",
  "other",
];

/**
 * The config boundary. `use.device` arrives as `unknown` because a project can
 * omit it entirely or be written in JavaScript, and every message names the
 * field to fix.
 */
export function parseDeviceOptions(raw: unknown): ResolvedOptions {
  if (typeof raw !== "object" || raw === null) {
    throw fail(
      "device",
      "must be an object. Set `use: { device: { ... } }` in your Playwright config.",
    );
  }
  const platform = read(raw, "platform");
  if (platform !== "ios" && platform !== "android")
    throw fail("device.platform", "must be 'ios' or 'android'.");

  const app = read(raw, "app");
  if (typeof app !== "string" || app.length === 0) {
    throw fail("device.app", "must be the bundle id or package name of the app under test.");
  }

  return {
    platform,
    app,
    readyWhen: parseReadyWhen(read(raw, "readyWhen")),
    names: parseNames(read(raw, "name")),
    relaunch: oneOf(
      "device.relaunch",
      read(raw, "relaunch"),
      ["per-test", "per-worker"],
      "per-test",
    ),
    onDeviceInUse: oneOf(
      "device.onDeviceInUse",
      read(raw, "onDeviceInUse"),
      ["fail", "reclaim"],
      "fail",
    ),
    actionTimeout: positive("device.actionTimeout", read(raw, "actionTimeout"), 10_000),
    settleQuietMs: positive("device.settleQuietMs", read(raw, "settleQuietMs"), 500),
    launchTimeout: positive("device.launchTimeout", read(raw, "launchTimeout"), 90_000),
    dismissDevOverlay: flag("device.dismissDevOverlay", read(raw, "dismissDevOverlay")),
    evidence: oneOf(
      "device.evidence",
      read(raw, "evidence"),
      ["on-failure", "always", "off"],
      "on-failure",
    ),
    sessionPrefix: text("device.sessionPrefix", read(raw, "sessionPrefix"), "pwad"),
  };
}

function read(source: object, key: string): unknown {
  return key in source ? Reflect.get(source, key) : undefined;
}

function parseReadyWhen(raw: unknown): Query {
  if (typeof raw !== "object" || raw === null) {
    throw fail(
      "device.readyWhen",
      "is required. Name something that only appears once the bundle has loaded, such as { text: 'GET STARTED' }.",
    );
  }
  const wanted = read(raw, "text");
  if (wanted !== undefined) {
    if (typeof wanted !== "string" || wanted.length === 0)
      throw fail("device.readyWhen.text", "must be a non-empty string.");
    return { name: textMatch(wanted, flag("device.readyWhen.exact", read(raw, "exact"))) };
  }
  const testId = read(raw, "testId");
  if (testId !== undefined) {
    if (typeof testId !== "string" || testId.length === 0)
      throw fail("device.readyWhen.testId", "must be a non-empty string.");
    return { testId: textMatch(testId, true) };
  }
  const wantedRole = read(raw, "role");
  const role = ROLES.find((candidate) => candidate === wantedRole);
  if (role === undefined) {
    throw fail("device.readyWhen", "must be one of { text }, { testId }, or { role, name }.");
  }
  const name = read(raw, "name");
  if (name === undefined) return { role };
  if (typeof name !== "string") throw fail("device.readyWhen.name", "must be a string.");
  return { role, name: textMatch(name) };
}

function parseNames(raw: unknown): readonly string[] {
  if (raw === undefined) return [];
  if (typeof raw === "string") return [raw];
  if (!Array.isArray(raw) || raw.length === 0 || raw.some((entry) => typeof entry !== "string")) {
    throw fail("device.name", "must be a device name or a non-empty array of device names.");
  }
  return raw;
}

/**
 * The device for one worker slot. A pool shorter than the slot is a config
 * error rather than two workers sharing a device.
 */
export function deviceNameForSlot(options: ResolvedOptions, slot: number): string | null {
  if (options.names.length === 0) return null;
  if (options.names.length === 1) return options.names[0] ?? null;
  const name = options.names[slot];
  if (name === undefined) {
    throw fail(
      "device.name",
      `lists ${String(options.names.length)} devices but Playwright asked for worker slot ${String(slot)}. Add a device or lower \`workers\`.`,
    );
  }
  return name;
}

export function sessionName(options: ResolvedOptions, project: string, slot: number): string {
  return `${options.sessionPrefix}-${project === "" ? "default" : project}-${String(slot)}`;
}

function oneOf<T extends string>(
  field: string,
  value: unknown,
  allowed: readonly T[],
  fallback: T,
): T {
  if (value === undefined) return fallback;
  const found = allowed.find((candidate) => candidate === value);
  if (found === undefined)
    throw fail(field, `must be one of ${allowed.map((one) => `'${one}'`).join(", ")}.`);
  return found;
}

function positive(field: string, value: unknown, fallback: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw fail(field, "must be a positive number of milliseconds.");
  }
  return value;
}

function flag(field: string, value: unknown): boolean {
  if (value === undefined) return false;
  if (typeof value !== "boolean") throw fail(field, "must be true or false.");
  return value;
}

function text(field: string, value: unknown, fallback: string): string {
  if (value === undefined) return fallback;
  if (typeof value !== "string" || value.length === 0)
    throw fail(field, "must be a non-empty string.");
  return value;
}

function fail(field: string, detail: string): DeviceTestError {
  return new DeviceTestError({ kind: "config", field, detail });
}
