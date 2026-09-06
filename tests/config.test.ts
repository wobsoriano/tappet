import { expect, test } from "vite-plus/test";
import { deviceNameForSlot, parseDeviceOptions, UNCONFIGURED_DEVICE } from "../src/core/config.ts";
import { sessionName } from "../src/core/session.ts";

const minimal = { platform: "ios", app: "com.example.app", readyWhen: { text: "GET STARTED" } };

test("parse fills every default", () => {
  const options = parseDeviceOptions(minimal);
  expect(options.relaunch).toBe("per-test");
  expect(options.onDeviceInUse).toBe("fail");
  expect(options.actionTimeout).toBe(10_000);
  expect(options.settleQuietMs).toBe(500);
  expect(options.launchTimeout).toBe(90_000);
  expect(options.dismissDevOverlay).toBe(false);
  expect(options.evidence).toBe("on-failure");
  expect(options.sessionPrefix).toBe("pwad");
  expect(options.names).toEqual([]);
});

test("the option fixture's unconfigured default is rejected by name", () => {
  expect(() => parseDeviceOptions(UNCONFIGURED_DEVICE)).toThrow(/device\.app/);
  expect(() => parseDeviceOptions(undefined)).toThrow(/use: \{ device/);
});

test("every required field names itself when it is wrong", () => {
  expect(() => parseDeviceOptions({ ...minimal, platform: "web" })).toThrow(/device\.platform/);
  expect(() => parseDeviceOptions({ ...minimal, app: "" })).toThrow(/device\.app/);
  expect(() => parseDeviceOptions({ platform: "ios", app: "a" })).toThrow(/device\.readyWhen/);
  expect(() => parseDeviceOptions({ ...minimal, readyWhen: { role: "menu" } })).toThrow(
    /device\.readyWhen/,
  );
  expect(() => parseDeviceOptions({ ...minimal, actionTimeout: 0 })).toThrow(
    /device\.actionTimeout/,
  );
  expect(() => parseDeviceOptions({ ...minimal, evidence: "sometimes" })).toThrow(
    /device\.evidence/,
  );
  expect(() => parseDeviceOptions({ ...minimal, name: [] })).toThrow(/device\.name/);
});

test("readyWhen accepts text, testId, and role forms", () => {
  expect(
    parseDeviceOptions({ ...minimal, readyWhen: { text: "Hi", exact: true } }).readyWhen,
  ).toEqual({
    name: { kind: "exact", value: "Hi" },
  });
  expect(parseDeviceOptions({ ...minimal, readyWhen: { testId: "root" } }).readyWhen).toEqual({
    testId: { kind: "exact", value: "root" },
  });
  expect(
    parseDeviceOptions({ ...minimal, readyWhen: { role: "button", name: "Home" } }).readyWhen,
  ).toEqual({
    role: "button",
    name: { kind: "substring", value: "Home" },
  });
});

test("a device pool is indexed by worker slot and a short pool is a config error", () => {
  const single = parseDeviceOptions({ ...minimal, name: "iPhone 17 Pro Max" });
  expect(deviceNameForSlot(single, 0)).toBe("iPhone 17 Pro Max");
  expect(deviceNameForSlot(single, 3)).toBe("iPhone 17 Pro Max");

  const pool = parseDeviceOptions({ ...minimal, name: ["one", "two"] });
  expect(deviceNameForSlot(pool, 1)).toBe("two");
  expect(() => deviceNameForSlot(pool, 2)).toThrow(/worker slot 2/);

  expect(deviceNameForSlot(parseDeviceOptions(minimal), 0)).toBe(null);
});

test("session names are deterministic so a replacement worker reuses one", () => {
  const options = parseDeviceOptions({ ...minimal, sessionPrefix: "pwad" });
  expect(sessionName(options, "ios", 2)).toBe("pwad-ios-2");
  expect(sessionName(options, "", 0)).toBe("pwad-default-0");
});
