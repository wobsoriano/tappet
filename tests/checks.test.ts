import { expect, test } from "vite-plus/test";
import { describeCheck, evaluate, type Check } from "../src/core/checks.ts";
import { textMatch } from "../src/core/query.ts";
import { resolve } from "../src/core/screen.ts";
import { formatFailure } from "../src/core/probe.ts";
import { loadScreen } from "./fixtures.ts";

const home = loadScreen("home");
const explore = loadScreen("explore");

const homeTab = resolve(home, { role: "button", name: textMatch("Home") });
const exploreTab = resolve(home, { role: "button", name: textMatch("Explore") });
const ambiguous = resolve(explore, { name: textMatch("Explore") });
const missing = resolve(home, { name: textMatch("Sign out") });

test("toBeVisible passes only for exactly one match", () => {
  expect(evaluate({ name: "toBeVisible" }, homeTab).pass).toBe(true);
  expect(evaluate({ name: "toBeVisible" }, missing).pass).toBe(false);
  expect(evaluate({ name: "toBeVisible" }, ambiguous).pass).toBe(false);
});

test("toHaveText compares the resolved node's name with the query's own text rules", () => {
  expect(evaluate({ name: "toHaveText", expected: textMatch("Home") }, homeTab).pass).toBe(true);
  expect(evaluate({ name: "toHaveText", expected: textMatch("home", true) }, homeTab).pass).toBe(
    false,
  );
  expect(evaluate({ name: "toHaveText", expected: textMatch("Home", true) }, homeTab).actual).toBe(
    `"Home"`,
  );
});

test("state checks read the node's own flags", () => {
  expect(evaluate({ name: "toBeSelected" }, homeTab).pass).toBe(true);
  expect(evaluate({ name: "toBeSelected" }, exploreTab).pass).toBe(false);
  expect(evaluate({ name: "toBeEnabled" }, homeTab).pass).toBe(true);
  expect(evaluate({ name: "toBeFocused" }, homeTab).pass).toBe(false);
});

test("toHaveCount counts distinct matches after absorption", () => {
  expect(evaluate({ name: "toHaveCount", expected: 2 }, ambiguous).pass).toBe(true);
  expect(evaluate({ name: "toHaveCount", expected: 0 }, missing).pass).toBe(true);
  expect(evaluate({ name: "toHaveCount", expected: 1 }, homeTab).pass).toBe(true);
});

test("describeCheck names the expectation for the Expected line", () => {
  expect(describeCheck({ name: "toBeVisible" })).toBe("visible");
  expect(describeCheck({ name: "toHaveText", expected: textMatch("Home") })).toBe(`text "Home"`);
  expect(describeCheck({ name: "toHaveCount", expected: 3 })).toBe("count 3");
});

test("a miss reports the locator, the expectation, the nearest names, and the screen", () => {
  const message = formatFailure({
    locator: "getByText('Sign out')",
    check: { name: "toBeVisible" },
    negate: false,
    resolution: missing,
    screen: home,
    timeoutMs: 3000,
    polls: 12,
  });
  expect(message).toContain("Locator: getByText('Sign out')");
  expect(message).toContain("Expected: visible");
  expect(message).toContain("Received: no node matched");
  expect(message).toContain("Timeout: 3000ms (12 snapshots)");
  expect(message).toContain("Screen:");
  expect(message).toContain(`@e29 [button] "Home" [selected]`);
  expect(message).toContain("screen.png and screen.txt are attached");
});

test("an ambiguous match reports every node and points at first and nth", () => {
  const check: Check = { name: "toBeVisible" };
  const message = formatFailure({
    locator: "getByText('Explore')",
    check,
    negate: false,
    resolution: ambiguous,
    screen: explore,
    timeoutMs: 5000,
    polls: 1,
  });
  expect(message).toContain("2 nodes matched");
  expect(message).toContain(`@e12 [text] "Explore"`);
  expect(message).toContain(`@e35 [button] "Explore"`);
  expect(message).toContain(".nth(n)");
  expect(message).toContain("Timeout: 5000ms (1 snapshot)");
});

test("a negated failure says so on the header and the expected line", () => {
  const message = formatFailure({
    locator: "getByText('Home')",
    check: { name: "toBeVisible" },
    negate: true,
    resolution: homeTab,
    screen: home,
    timeoutMs: 1000,
    polls: 4,
  });
  expect(message).toContain("Expected not.toBeVisible");
  expect(message).toContain("Expected: not visible");
});
