import { expect, test } from "vite-plus/test";
import { createApp } from "../src/core/app.ts";
import { parseDeviceOptions, type DeviceOptions } from "../src/core/config.ts";
import { DeviceTestError } from "../src/core/errors.ts";
import { silentSink } from "../src/core/report.ts";
import { openSession } from "../src/core/session.ts";
import { createFakeDriver, type FakeDriver } from "./fake-driver.ts";

const options: DeviceOptions = {
  platform: "ios",
  app: "com.wobsoriano.awesometodo",
  name: "iPhone 17 Pro Max",
  readyWhen: { text: "GET STARTED" },
  launchTimeout: 1000,
  actionTimeout: 600,
};

function open(driver: FakeDriver, overrides?: Partial<DeviceOptions>) {
  return openSession({
    options: parseDeviceOptions({ ...options, ...overrides }),
    slot: 0,
    scope: "ios",
    sink: silentSink,
    createDriver: () => driver,
  });
}

test("openSession reclaims a leftover of its own name, opens, and holds for the ready gate", async () => {
  const driver = createFakeDriver();
  const session = await open(driver);
  expect(session.name).toBe("pwad-ios-0");
  expect(driver.calls).toEqual([
    "close pwad-ios-0",
    "open com.wobsoriano.awesometodo relaunch=true",
    "capture",
  ]);
  expect(session.state().phase).toBe("ready");
});

test("a device held by one of our own leftovers is reclaimed and the open retried once", async () => {
  const driver = createFakeDriver();
  driver.openOutcomes.push({
    kind: "device-busy",
    owner: "pwad-ios-1",
    detail: `in use by session "pwad-ios-1"`,
  });
  await open(driver);
  expect(driver.calls).toContain("close pwad-ios-1");
  expect(driver.calls.filter((call) => call.startsWith("open")).length).toBe(2);
});

test("a device held by a foreign session names the owner and the release command", async () => {
  const driver = createFakeDriver();
  driver.openOutcomes.push({
    kind: "device-busy",
    owner: "lex",
    detail: `in use by session "lex"`,
  });
  const error = await open(driver).catch((thrown: unknown) => thrown);
  expect(error).toBeInstanceOf(DeviceTestError);
  if (!(error instanceof DeviceTestError)) return;
  expect(error.info.kind).toBe("device-in-use");
  expect(error.message).toContain(`session "lex"`);
  expect(error.message).toContain("agent-device close --session lex");
  expect(error.message).toContain("onDeviceInUse to 'reclaim'");
});

test("onDeviceInUse reclaim takes over a foreign session instead of failing", async () => {
  const driver = createFakeDriver();
  driver.openOutcomes.push({ kind: "device-busy", owner: "lex", detail: "in use" });
  await open(driver, { onDeviceInUse: "reclaim" });
  expect(driver.calls).toContain("close lex");
});

test("a session bound to another device is closed by name and reopened once", async () => {
  const driver = createFakeDriver();
  driver.openOutcomes.push({
    kind: "session-rebound",
    boundTo: "android device emulator-5554",
    detail: "already bound",
  });
  await open(driver);
  expect(driver.calls.filter((call) => call === "close pwad-ios-0").length).toBe(2);
});

test("a bundle that never loads fails with the ready locator and the screen listing", async () => {
  const driver = createFakeDriver({ screens: ["explore"] });
  const error = await open(driver, { readyWhen: { text: "Fresh start" } }).catch(
    (thrown: unknown) => thrown,
  );
  expect(error).toBeInstanceOf(DeviceTestError);
  if (!(error instanceof DeviceTestError)) return;
  expect(error.info.kind).toBe("not-ready");
  expect(error.message).toContain("readyWhen: getByText('Fresh start')");
  expect(error.message).toContain(`@e35 [button] "Explore"`);
});

test("close is idempotent and reaches closed even when the driver call fails", async () => {
  const driver = createFakeDriver();
  const session = await open(driver);
  driver.close = () => Promise.reject(new Error("daemon gone"));
  await expect(session.close("requested")).rejects.toThrow("daemon gone");
  expect(session.state().phase).toBe("closed");
  await session.close("worker-exit");
});

test("a tap resolves against a fresh screen and dispatches a generation-pinned ref", async () => {
  const driver = createFakeDriver();
  const session = await open(driver);
  const app = createApp(session, silentSink);
  await app.getByRole("button", { name: "Explore" }).tap();
  expect(driver.calls.at(-1)).toMatch(/^tap @e30~s776575 settle=/);
});

test("an ambiguous locator fails an action at once with every match listed", async () => {
  const driver = createFakeDriver({ screens: ["explore"] });
  const session = await open(driver, { readyWhen: { text: "Expo documentation" } });
  const app = createApp(session, silentSink);
  const error = await app
    .getByText("Explore")
    .tap()
    .catch((thrown: unknown) => thrown);
  expect(error).toBeInstanceOf(DeviceTestError);
  if (!(error instanceof DeviceTestError)) return;
  expect(error.info.kind).toBe("strict-mode");
  expect(error.message).toContain(`@e12 [text] "Explore"`);
  expect(error.message).toContain(`@e35 [button] "Explore"`);
  expect(error.message).toContain(".nth(n)");
});

test("first picks one node out of the same ambiguous locator", async () => {
  const driver = createFakeDriver({ screens: ["explore"] });
  const session = await open(driver, { readyWhen: { text: "Expo documentation" } });
  const app = createApp(session, silentSink);
  await app.getByText("Explore").first().tap();
  expect(driver.calls.at(-1)).toMatch(/^tap @e12~s355823 settle=/);
});

test("a stale ref re-captures and retries once, then reports", async () => {
  const driver = createFakeDriver();
  const session = await open(driver);
  const app = createApp(session, silentSink);

  driver.staleRefs = 1;
  await app.getByRole("button", { name: "Home" }).tap();
  expect(driver.calls.filter((call) => call.startsWith("tap")).length).toBe(2);

  driver.staleRefs = 2;
  const error = await app
    .getByRole("button", { name: "Home" })
    .tap()
    .catch((thrown: unknown) => thrown);
  expect(error).toBeInstanceOf(DeviceTestError);
  if (!(error instanceof DeviceTestError)) return;
  expect(error.message).toContain("the screen changed before the action reached it");
});

test("an action waits for its target and then reports what was on screen", async () => {
  const driver = createFakeDriver();
  const session = await open(driver);
  const app = createApp(session, silentSink);
  const started = Date.now();
  const error = await app
    .getByText("Sign out")
    .tap()
    .catch((thrown: unknown) => thrown);
  expect(Date.now() - started).toBeGreaterThanOrEqual(400);
  expect(error).toBeInstanceOf(DeviceTestError);
  if (!(error instanceof DeviceTestError)) return;
  expect(error.info.kind).toBe("not-found");
  expect(error.message).toContain(`@e14 [text] "GET STARTED"`);
});

test("count reports distinct matches after absorption", async () => {
  const driver = createFakeDriver({ screens: ["explore"] });
  const session = await open(driver, { readyWhen: { text: "Expo documentation" } });
  const app = createApp(session, silentSink);
  expect(await app.getByText("Explore").count()).toBe(2);
  expect(await app.getByText("Sign out").count()).toBe(0);
});

test("every command runs on one queue, so a snapshot never lands inside another action", async () => {
  const driver = createFakeDriver();
  const session = await open(driver);
  const app = createApp(session, silentSink);
  driver.calls.length = 0;
  await Promise.all([
    app.getByRole("button", { name: "Home" }).tap(),
    app.screen(),
    app.getByRole("button", { name: "Explore" }).tap(),
  ]);
  expect(driver.calls.map((call) => call.replace(/ settle=\d+$/, ""))).toEqual([
    "capture",
    "tap @e29~s776575",
    "capture",
    "capture",
    "tap @e30~s776575",
  ]);
});

test("a rejected command does not wedge the queue", async () => {
  const driver = createFakeDriver();
  const session = await open(driver);
  const app = createApp(session, silentSink);
  await app
    .getByText("Sign out")
    .tap()
    .catch(() => undefined);
  await app.getByRole("button", { name: "Home" }).tap();
  expect(driver.calls.at(-1)).toMatch(/^tap @e29~s776575 settle=/);
});

test("a device that goes away breaks the session and every later call names the root cause", async () => {
  const driver = createFakeDriver();
  const session = await open(driver);
  driver.capture = () =>
    Promise.reject(
      new DeviceTestError({
        kind: "driver",
        command: "snapshot",
        failure: { kind: "device-missing", detail: "simulator shut down" },
      }),
    );

  await expect(session.screen()).rejects.toThrow("no matching device is booted");
  expect(session.state().phase).toBe("broken");
  expect(session.failure()?.kind).toBe("device-missing");
  await expect(session.screen()).rejects.toThrow("no matching device is booted");
});

test("a readyWhen that matches twice still counts as ready", async () => {
  const driver = createFakeDriver({ screens: ["explore"] });
  const session = await open(driver, { readyWhen: { text: "Explore" } });
  expect(session.state().phase).toBe("ready");
});

test("a ready gate that times out reports what it actually waited", async () => {
  const driver = createFakeDriver({ screens: ["explore"] });
  const error = await open(driver, {
    readyWhen: { text: "Fresh start" },
    launchTimeout: 500,
  }).catch((thrown: unknown) => thrown);
  expect(error).toBeInstanceOf(DeviceTestError);
  if (!(error instanceof DeviceTestError) || error.info.kind !== "not-ready") return;
  expect(error.info.timeoutMs).toBeLessThanOrEqual(600);
  expect(error.info.timeoutMs).toBeGreaterThan(0);
});

test("waiting for a target and settling after it share one action budget", async () => {
  const driver = createFakeDriver({ screens: ["explore", "explore", "home"] });
  const session = await open(driver, {
    readyWhen: { text: "Expo documentation" },
    actionTimeout: 4000,
    settleQuietMs: 100,
  });
  const app = createApp(session, silentSink);
  await app.getByRole("text", { name: "Fresh start" }).tap();
  const settle = /settle=(\d+)/.exec(driver.calls.at(-1) ?? "");
  expect(Number(settle?.[1])).toBeLessThan(3900);
});

test("fill dispatches again when the keyboard under-delivers, and reports the text that landed", async () => {
  const driver = createFakeDriver();
  driver.fillOutcomes.push("r@example.com", "rob@exa");
  const session = await open(driver);
  const app = createApp(session, silentSink);

  await app.getByRole("button", { name: "Explore" }).fill("rob@example.com");

  expect(driver.calls.filter((call) => call.startsWith("fill")).length).toBe(3);
});

test("a fill that never lands names the locator, both values, and the attempts", async () => {
  const driver = createFakeDriver();
  driver.fillOutcomes.push(...Array<string>(50).fill("r@example.com"));
  const session = await open(driver);
  const app = createApp(session, silentSink);

  const error = await app
    .getByRole("button", { name: "Explore" })
    .fill("rob@example.com")
    .catch((thrown: unknown) => thrown);

  expect(error).toBeInstanceOf(DeviceTestError);
  if (!(error instanceof DeviceTestError)) return;
  expect(error.info.kind).toBe("fill-unconfirmed");
  expect(error.message).toContain(`Expected value: "rob@example.com"`);
  expect(error.message).toContain(`Actual value: "r@example.com"`);
  expect(error.message).toMatch(/after \d+ attempts/);
});
