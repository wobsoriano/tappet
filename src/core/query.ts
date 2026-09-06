import type { ScreenNode } from "./screen.ts";

/**
 * The normalized role vocabulary, spelled the way `agent-device snapshot`
 * prints it so a failure listing and a manual snapshot read alike. iOS reports
 * XCUIElement type names and Android reports widget class names; both map here.
 *
 * Invariant: every raw type maps to exactly one role and an unrecognized type
 * maps to `other`. `other` is a real role, not a failure signal, because React
 * Native emits many labelled container views with no semantic type.
 */
export type Role =
  | "application"
  | "window"
  | "button"
  | "text"
  | "text-field"
  | "secure-text-field"
  | "link"
  | "image"
  | "switch"
  | "slider"
  | "tab-bar"
  | "scroll-area"
  | "cell"
  | "alert"
  | "other";

/** How one string field is compared. */
export type TextMatch =
  | { readonly kind: "substring"; readonly value: string }
  | { readonly kind: "exact"; readonly value: string }
  | { readonly kind: "regex"; readonly value: RegExp };

/**
 * A pure conjunctive description of a node. Building one performs no I/O.
 *
 * Invariants: every field narrows, so an empty query matches every node.
 * `name` is compared against the node's name and its value, which is what
 * makes `getByText` behave like Playwright's. `index` is the strictness
 * opt-out set by `.first()` and `.nth(n)`; without it more than one distinct
 * match is an error.
 */
export type Query = {
  readonly testId?: TextMatch;
  readonly name?: TextMatch;
  readonly value?: TextMatch;
  readonly role?: Role;
  readonly enabled?: boolean;
  readonly selected?: boolean;
  readonly focused?: boolean;
  readonly where?: (node: ScreenNode) => boolean;
  readonly index?: number;
};

/** Applied to both sides of every string comparison, so a label wrapped across lines still matches one typed on one line. */
export function normalizeText(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

/**
 * Playwright's default text semantics: case-insensitive substring after
 * whitespace normalization. `exact` is whole-string and case-sensitive, still
 * normalized.
 */
export function textMatch(value: string | RegExp, exact?: boolean): TextMatch {
  if (value instanceof RegExp) return { kind: "regex", value };
  return exact === true
    ? { kind: "exact", value: normalizeText(value) }
    : { kind: "substring", value: normalizeText(value) };
}

export function matchesText(match: TextMatch, candidate: string | null): boolean {
  if (candidate === null) return false;
  switch (match.kind) {
    case "exact":
      return candidate === match.value;
    case "substring":
      return candidate.toLowerCase().includes(match.value.toLowerCase());
    case "regex":
      return match.value.test(candidate);
    default: {
      const never: never = match;
      throw new Error(`unhandled text match ${JSON.stringify(never)}`);
    }
  }
}

/**
 * Renders a query back into the factory call that produces it, so the
 * `Locator:` line of a failure reads like the line the author wrote. The one
 * place a query is formatted.
 */
export function describeQuery(query: Query): string {
  const suffix = describeIndex(query.index);
  const fields = describeExtraFields(query);
  const plain = fields.length === 0 && query.value === undefined;
  if (plain && query.testId !== undefined && query.name === undefined && query.role === undefined) {
    return `getByTestId(${describeMatch(query.testId)})${suffix}`;
  }
  if (plain && query.role !== undefined && query.testId === undefined) {
    const name =
      query.name === undefined
        ? ""
        : `, { name: ${describeMatch(query.name)}${describeExact(query.name)} }`;
    return `getByRole('${query.role}'${name})${suffix}`;
  }
  if (plain && query.name !== undefined && query.testId === undefined && query.role === undefined) {
    const exact = query.name.kind === "exact" ? ", { exact: true }" : "";
    return `getByText(${describeMatch(query.name)}${exact})${suffix}`;
  }
  const parts = [
    query.testId === undefined ? null : `testId: ${describeMatch(query.testId)}`,
    query.name === undefined ? null : `name: ${describeMatch(query.name)}`,
    query.value === undefined ? null : `value: ${describeMatch(query.value)}`,
    query.role === undefined ? null : `role: '${query.role}'`,
    ...fields,
  ].filter((part) => part !== null);
  return `locator({ ${parts.join(", ")} })${suffix}`;
}

function describeExtraFields(query: Query): string[] {
  return [
    query.enabled === undefined ? null : `enabled: ${String(query.enabled)}`,
    query.selected === undefined ? null : `selected: ${String(query.selected)}`,
    query.focused === undefined ? null : `focused: ${String(query.focused)}`,
    query.where === undefined ? null : "where: <predicate>",
  ].filter((part) => part !== null);
}

function describeExact(match: TextMatch): string {
  return match.kind === "exact" ? ", exact: true" : "";
}

function describeMatch(match: TextMatch): string {
  return match.kind === "regex" ? String(match.value) : `'${match.value}'`;
}

function describeIndex(index: number | undefined): string {
  if (index === undefined) return "";
  return index === 0 ? ".first()" : `.nth(${String(index)})`;
}
