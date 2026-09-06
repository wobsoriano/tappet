import { matchesText, normalizeText, type Query, type Role } from "./query.ts";

export type Platform = "ios" | "android";

export type Rect = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

/**
 * One node of a parsed screen. Deliberately not the driver's snapshot node:
 * `label` becomes `name`, `identifier` becomes `testId`, and `type` is
 * normalized into `role` with the platform spelling kept as `rawType` for
 * messages.
 *
 * Invariant: `parent` links form a forest rooted at nodes whose `parentIndex`
 * was absent, built once at parse time so an ancestor walk stays O(depth).
 */
export type ScreenNode = {
  readonly ref: string;
  readonly index: number;
  readonly parent: ScreenNode | null;
  readonly depth: number;
  readonly role: Role;
  readonly rawType: string;
  readonly name: string | null;
  readonly value: string | null;
  readonly testId: string | null;
  readonly rect: Rect | null;
  readonly enabled: boolean;
  readonly selected: boolean;
  readonly focused: boolean;
};

/**
 * A frozen observation of the device at one instant.
 *
 * Invariant: a screen is never refreshed in place. Every state-changing
 * command advances the driver's ref generation, so a screen captured before
 * one can only mint refs the driver will reject.
 */
export type Screen = {
  readonly nodes: readonly ScreenNode[];
  readonly generation: number | null;
  readonly appId: string | null;
  readonly truncated: boolean;
  readonly capturedAt: number;
};

declare const pinnedRefBrand: unique symbol;

/**
 * A ref pinned to the generation it was minted from, in the driver's
 * `@e12~s776575` form. Only `pin` produces one. The driver rejects a pin from
 * a superseded generation before dispatch, which turns a silent mistap into a
 * deterministic failure the session can recover from.
 */
export type PinnedRef = string & { readonly [pinnedRefBrand]: true };

export type Resolution =
  | { readonly outcome: "one"; readonly node: ScreenNode; readonly absorbed: number }
  | { readonly outcome: "none"; readonly nearest: readonly ScreenNode[] }
  | { readonly outcome: "many"; readonly nodes: readonly ScreenNode[] };

/**
 * The structural shape of the driver's snapshot response. Declared here rather
 * than imported so the core never depends on `agent-device`; the real
 * `CaptureSnapshotResult` satisfies it and so does a JSON fixture.
 */
export type RawSnapshot = {
  readonly nodes: ReadonlyArray<{
    readonly ref: string;
    readonly index: number;
    readonly type?: string;
    readonly role?: string;
    readonly label?: string;
    readonly value?: string;
    readonly identifier?: string;
    readonly rect?: Rect;
    readonly enabled?: boolean;
    readonly selected?: boolean;
    readonly focused?: boolean;
    readonly depth?: number;
    readonly parentIndex?: number;
    readonly inheritsLabel?: true;
    readonly inheritsIdentifier?: true;
  }>;
  readonly truncated?: boolean;
  readonly appBundleId?: string;
  readonly refsGeneration?: number;
};

const IOS_ROLES: Readonly<Record<string, Role>> = {
  Application: "application",
  Window: "window",
  Button: "button",
  StaticText: "text",
  TextView: "text",
  TextField: "text-field",
  SearchField: "text-field",
  SecureTextField: "secure-text-field",
  Link: "link",
  Image: "image",
  Icon: "image",
  Switch: "switch",
  Toggle: "switch",
  Slider: "slider",
  TabBar: "tab-bar",
  Tab: "button",
  ScrollView: "scroll-area",
  ScrollArea: "scroll-area",
  Table: "scroll-area",
  CollectionView: "scroll-area",
  Cell: "cell",
  Alert: "alert",
  Sheet: "alert",
  Other: "other",
};

// Android class names are inference until an Android probe runs; anything
// unrecognized falls through to `other`, which is a legal role.
const ANDROID_ROLES: Readonly<Record<string, Role>> = {
  "android.widget.Button": "button",
  "android.widget.ImageButton": "button",
  "android.widget.TextView": "text",
  "android.widget.EditText": "text-field",
  "android.widget.ImageView": "image",
  "android.widget.Switch": "switch",
  "android.widget.CheckBox": "switch",
  "android.widget.SeekBar": "slider",
  "android.widget.ScrollView": "scroll-area",
  "android.widget.HorizontalScrollView": "scroll-area",
  "androidx.recyclerview.widget.RecyclerView": "scroll-area",
  "android.widget.FrameLayout": "other",
  "android.widget.LinearLayout": "other",
};

export function roleOf(rawType: string, platform: Platform): Role {
  const table = platform === "ios" ? IOS_ROLES : ANDROID_ROLES;
  const direct = table[rawType];
  if (direct !== undefined) return direct;
  const short = rawType.slice(rawType.lastIndexOf(".") + 1);
  return table[short] ?? "other";
}

/**
 * The parse boundary. Everything past this point trusts its types.
 *
 * `inheritsLabel` and `inheritsIdentifier` mean the driver omitted a value
 * that string-equals the nearest ancestor's, so those are restored here rather
 * than leaving a hole a matcher would read as absent.
 */
export function parseScreen(raw: RawSnapshot, platform: Platform): Screen {
  const nodes: ScreenNode[] = [];
  const byIndex = new Map<number, ScreenNode>();
  for (const source of raw.nodes) {
    const parent =
      source.parentIndex === undefined ? null : (byIndex.get(source.parentIndex) ?? null);
    const rawType = source.type ?? source.role ?? "Other";
    const node: ScreenNode = {
      ref: source.ref.startsWith("@") ? source.ref : `@${source.ref}`,
      index: source.index,
      parent,
      depth: source.depth ?? (parent === null ? 0 : parent.depth + 1),
      role: roleOf(rawType, platform),
      rawType,
      name: inherited(source.label, source.inheritsLabel, parent, (a) => a.name),
      value: source.value === undefined ? null : normalizeText(source.value),
      testId: inherited(source.identifier, source.inheritsIdentifier, parent, (a) => a.testId),
      rect: source.rect ?? null,
      enabled: source.enabled ?? true,
      selected: source.selected ?? false,
      focused: source.focused ?? false,
    };
    nodes.push(node);
    byIndex.set(node.index, node);
  }
  return Object.freeze({
    nodes: Object.freeze(nodes),
    generation: raw.refsGeneration ?? null,
    appId: raw.appBundleId ?? null,
    truncated: raw.truncated ?? false,
    capturedAt: Date.now(),
  });
}

function inherited(
  own: string | undefined,
  inherits: true | undefined,
  parent: ScreenNode | null,
  read: (ancestor: ScreenNode) => string | null,
): string | null {
  if (own !== undefined) return normalizeText(own);
  if (inherits !== true) return null;
  for (let ancestor = parent; ancestor !== null; ancestor = ancestor.parent) {
    const value = read(ancestor);
    if (value !== null) return value;
  }
  return null;
}

/**
 * The single resolver, shared by actions and assertions so the two can never
 * disagree about which node was meant.
 *
 * Rule order: filter by every query field, then ancestor absorption, then
 * `index`.
 *
 * Ancestor absorption drops a match when a descendant match carries the same
 * text identity. On the sample app "Live from the cloud" is carried both by an
 * `[other]` container and by its `[text]` child, and "Home" by an `[other]`
 * wrapper and the `[button]` inside it; each pair is one thing on screen.
 * Matches in disjoint subtrees stay distinct, so "Explore" on the Explore
 * screen is still the heading and the tab button.
 */
export function resolve(screen: Screen, query: Query): Resolution {
  const matched = screen.nodes.filter((node) => matchesQuery(node, query));
  const distinct = absorbAncestors(matched);
  if (query.index !== undefined) {
    const picked = distinct.at(query.index);
    if (picked === undefined) return { outcome: "none", nearest: nearestTo(screen, query) };
    return { outcome: "one", node: picked, absorbed: absorbedCount(matched, picked) };
  }
  const first = distinct[0];
  if (first === undefined) return { outcome: "none", nearest: nearestTo(screen, query) };
  if (distinct.length > 1) return { outcome: "many", nodes: distinct };
  return { outcome: "one", node: first, absorbed: absorbedCount(matched, first) };
}

function matchesQuery(node: ScreenNode, query: Query): boolean {
  if (query.role !== undefined && node.role !== query.role) return false;
  if (query.testId !== undefined && !matchesText(query.testId, node.testId)) return false;
  if (query.value !== undefined && !matchesText(query.value, node.value)) return false;
  if (
    query.name !== undefined &&
    !matchesText(query.name, node.name) &&
    !matchesText(query.name, node.value)
  ) {
    return false;
  }
  if (query.enabled !== undefined && node.enabled !== query.enabled) return false;
  if (query.selected !== undefined && node.selected !== query.selected) return false;
  if (query.focused !== undefined && node.focused !== query.focused) return false;
  if (query.where !== undefined && !query.where(node)) return false;
  return true;
}

/** The text a node is identified by. Two nodes on one ancestor chain sharing it are one thing on screen. */
function identity(node: ScreenNode): string {
  return `${node.name ?? ""} ${node.value ?? ""} ${node.testId ?? ""}`;
}

function absorbAncestors(matched: readonly ScreenNode[]): readonly ScreenNode[] {
  return matched.filter(
    (candidate) =>
      !matched.some(
        (other) =>
          other !== candidate &&
          isDescendant(other, candidate) &&
          identity(other) === identity(candidate),
      ),
  );
}

function absorbedCount(matched: readonly ScreenNode[], survivor: ScreenNode): number {
  return matched.filter(
    (node) =>
      node !== survivor && isDescendant(survivor, node) && identity(node) === identity(survivor),
  ).length;
}

export function isDescendant(node: ScreenNode, ancestor: ScreenNode): boolean {
  for (let walk = node.parent; walk !== null; walk = walk.parent) {
    if (walk === ancestor) return true;
  }
  return false;
}

/**
 * The named nodes closest to what the query asked for. A miss is usually a
 * wording drift, so listing near names is what makes the message actionable.
 */
function nearestTo(screen: Screen, query: Query): readonly ScreenNode[] {
  const wanted = wantedText(query);
  const named = screen.nodes.filter((node) => node.name !== null || node.testId !== null);
  if (wanted === null) return named.slice(0, 5);
  const target = wanted.toLowerCase();
  return named
    .map((node) => ({
      node,
      score: overlap(target, (node.name ?? node.testId ?? "").toLowerCase()),
    }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map((entry) => entry.node);
}

function wantedText(query: Query): string | null {
  for (const match of [query.name, query.testId, query.value]) {
    if (match !== undefined && match.kind !== "regex") return match.value;
  }
  return null;
}

function overlap(wanted: string, candidate: string): number {
  const words = wanted.split(" ").filter((word) => word.length > 2);
  const hits = words.filter((word) => candidate.includes(word)).length;
  if (hits > 0) return hits / words.length;
  return candidate.includes(wanted) || wanted.includes(candidate) ? 0.5 : 0;
}

/** Mints a generation-pinned ref. A screen with no generation cannot pin, so the caller must re-capture. */
export function pin(screen: Screen, node: ScreenNode): PinnedRef {
  if (screen.generation === null) {
    throw new Error(
      `cannot pin ${node.ref}: the driver returned no ref generation for this snapshot`,
    );
  }
  return `${node.ref}~s${String(screen.generation)}` as PinnedRef;
}

/**
 * The one tree renderer, used by failure messages and by the `screen.txt`
 * attachment so the terminal and the report agree. The vocabulary is the CLI's
 * own `[role] "label"` form.
 */
export function renderScreen(screen: Screen, options?: { readonly maxNodes?: number }): string {
  const max = options?.maxNodes ?? screen.nodes.length;
  const lines = screen.nodes.slice(0, max).map((node) => renderNode(node));
  if (screen.nodes.length > max) {
    lines.push(`  ... ${String(screen.nodes.length - max)} more nodes`);
  }
  return lines.join("\n");
}

export function renderNode(node: ScreenNode): string {
  const indent = "  ".repeat(node.depth);
  const name = node.name === null ? "" : ` "${node.name}"`;
  const testId = node.testId === null ? "" : ` #${node.testId}`;
  const flags = [
    node.selected ? "selected" : null,
    node.focused ? "focused" : null,
    node.enabled ? null : "disabled",
  ]
    .filter((flag) => flag !== null)
    .map((flag) => ` [${flag}]`)
    .join("");
  return `${indent}${node.ref} [${node.role}]${name}${testId}${flags}`;
}
