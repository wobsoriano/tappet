import { matchesText, normalizeText, type TextMatch } from "./query.ts";
import type { Resolution, ScreenNode } from "./screen.ts";

/**
 * An assertion as data. Adapters turn each `name` into a matcher; the poll and
 * the message live in `probe`, so two runners produce identical failures.
 */
export type Check =
  | { readonly name: "toBeVisible" }
  | { readonly name: "toHaveText"; readonly expected: TextMatch }
  | { readonly name: "toHaveValue"; readonly expected: TextMatch }
  | { readonly name: "toBeEnabled" }
  | { readonly name: "toBeSelected" }
  | { readonly name: "toBeFocused" }
  | { readonly name: "toHaveCount"; readonly expected: number };

export type CheckName = Check["name"];

export type Verdict = {
  readonly pass: boolean;
  /** What the screen actually held, for the `Received:` line. Null when nothing matched. */
  readonly actual: string | null;
};

/**
 * Pure evaluation of one check against one resolution.
 *
 * A `many` outcome never passes anything but `toHaveCount`: an ambiguous
 * locator is a strictness violation, and it reports through the same message
 * path as a plain mismatch rather than guessing which node was meant.
 */
export function evaluate(check: Check, resolution: Resolution): Verdict {
  if (check.name === "toHaveCount") {
    const count = countOf(resolution);
    return { pass: count === check.expected, actual: String(count) };
  }
  if (resolution.outcome === "none") return { pass: false, actual: null };
  if (resolution.outcome === "many") {
    return { pass: false, actual: `${String(resolution.nodes.length)} matching nodes` };
  }
  const node = resolution.node;
  switch (check.name) {
    case "toBeVisible":
      return { pass: true, actual: describeNode(node) };
    case "toHaveText": {
      const text = node.name ?? node.value;
      return {
        pass: matchesText(check.expected, text),
        actual: text === null ? null : `"${text}"`,
      };
    }
    case "toHaveValue":
      return {
        pass: matchesText(check.expected, node.value),
        actual: node.value === null ? null : `"${node.value}"`,
      };
    case "toBeEnabled":
      return { pass: node.enabled, actual: node.enabled ? "enabled" : "disabled" };
    case "toBeSelected":
      return { pass: node.selected, actual: node.selected ? "selected" : "not selected" };
    case "toBeFocused":
      return { pass: node.focused, actual: node.focused ? "focused" : "not focused" };
    default: {
      const never: never = check;
      throw new Error(`unhandled check ${JSON.stringify(never)}`);
    }
  }
}

function countOf(resolution: Resolution): number {
  switch (resolution.outcome) {
    case "one":
      return 1;
    case "none":
      return 0;
    case "many":
      return resolution.nodes.length;
    default: {
      const never: never = resolution;
      throw new Error(`unhandled resolution ${JSON.stringify(never)}`);
    }
  }
}

/** The `Expected:` line. */
export function describeCheck(check: Check): string {
  switch (check.name) {
    case "toBeVisible":
      return "visible";
    case "toHaveText":
      return `text ${describeExpected(check.expected)}`;
    case "toHaveValue":
      return `value ${describeExpected(check.expected)}`;
    case "toBeEnabled":
      return "enabled";
    case "toBeSelected":
      return "selected";
    case "toBeFocused":
      return "focused";
    case "toHaveCount":
      return `count ${String(check.expected)}`;
    default: {
      const never: never = check;
      throw new Error(`unhandled check ${JSON.stringify(never)}`);
    }
  }
}

function describeExpected(match: TextMatch): string {
  return match.kind === "regex" ? String(match.value) : `"${match.value}"`;
}

export function describeNode(node: ScreenNode): string {
  const name = node.name === null ? "" : ` "${normalizeText(node.name)}"`;
  return `${node.ref} [${node.role}]${name}`;
}
