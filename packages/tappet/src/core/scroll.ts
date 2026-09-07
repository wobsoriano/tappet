import type { ScrollDirection } from './driver.ts';
import type { Query } from './query.ts';
import { resolve, type Rect, type Screen, type ScreenNode } from './screen.ts';

/** What a search did to reach its target, for a failure message. */
export type ScrollTrail = { readonly steps: number; readonly direction: ScrollDirection };

/** What a scroll search needs from a session. A `SessionDevice` supplies it. */
export type ScrollDevice = {
  captureRaw(): Promise<Screen>;
  scroll(direction: ScrollDirection, budgetMs: number): Promise<void>;
};

/**
 * One search for a target that is not on screen yet.
 *
 * It owns two rules. A search never reverses, because a hint pointing back the
 * way it came means the container ran out rather than that the target is
 * behind us, and reversing turns a finished search into an oscillation that
 * burns the whole budget looking like progress. And it stops at `maxSteps`
 * whatever the clock says, so a screen that scrolls forever cannot.
 */
export type ScrollSearch = {
  /** Null until the first step, then the one direction every later step uses. */
  trail(): ScrollTrail | null;
  /**
   * Scrolls one step toward whatever `query` names. False means the search is
   * over: nothing on screen says which way to go, the next hint would reverse,
   * or the step cap is spent.
   */
  step(screen: Screen, query: Query, budgetMs: number): Promise<boolean>;
};

const MAX_SCROLL_STEPS = 20;

export function createScrollSearch(
  device: ScrollDevice,
  maxSteps = MAX_SCROLL_STEPS,
): ScrollSearch {
  let committed: ScrollDirection | null = null;
  let steps = 0;
  return {
    trail: () => (committed === null ? null : { steps, direction: committed }),
    step: async (screen, query, budgetMs) => {
      if (steps >= maxSteps) return false;
      const next = directionToward(screen, await device.captureRaw(), query);
      if (next === null || (committed !== null && next !== committed)) return false;
      committed = next;
      await device.scroll(next, budgetMs);
      steps += 1;
      return true;
    },
  };
}

/**
 * Which way the target lies, or null when nothing on screen says.
 *
 * Two sources, in order of how much they know. The raw tree places the target
 * itself, so when it carries the node its rect against the rect of the scroll
 * container clipping it is an answer rather than a guess. That is the iOS
 * case. Android's raw tree stops at the window, so nothing there places an
 * off-screen row, and the only evidence left is the container saying it is
 * holding content of its own out of view.
 */
export function directionToward(
  screen: Screen,
  raw: Screen | null,
  query: Query,
): ScrollDirection | null {
  return (raw === null ? null : outsideViewport(raw, query)) ?? hiddenContentIn(screen);
}

function outsideViewport(raw: Screen, query: Query): ScrollDirection | null {
  const found = resolve(raw, query);
  if (found.outcome !== 'one') return null;
  const target = found.node.rect;
  const viewport = clippingRect(found.node);
  if (target === null || viewport === null) return null;
  if (target.y >= viewport.y + viewport.height) return 'down';
  if (target.y + target.height <= viewport.y) return 'up';
  if (target.x >= viewport.x + viewport.width) return 'right';
  if (target.x + target.width <= viewport.x) return 'left';
  return null;
}

/**
 * The rect of the nearest scrollable ancestor, which is the window onto the
 * content the target sits in. A scroll container reports its own visible rect
 * rather than the rect of everything it holds, so a target beyond that rect is
 * a target the container has scrolled away.
 */
function clippingRect(node: ScreenNode): Rect | null {
  for (let walk = node.parent; walk !== null; walk = walk.parent) {
    if (walk.role === 'scroll-area' && walk.rect !== null) return walk.rect;
  }
  return null;
}

function hiddenContentIn(screen: Screen): ScrollDirection | null {
  if (screen.nodes.some((node) => node.hiddenContentBelow)) return 'down';
  if (screen.nodes.some((node) => node.hiddenContentAbove)) return 'up';
  return null;
}
