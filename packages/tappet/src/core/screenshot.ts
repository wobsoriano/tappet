import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';

/** A rectangle in image pixels, which is what a snapshot rect becomes once it is scaled. */
export type PixelBox = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

export type Size = { readonly width: number; readonly height: number };

export type CompareOptions = {
  /** pixelmatch's per-pixel colour distance, 0 to 1. Smaller is stricter. */
  readonly threshold: number;
  /** The share of the image allowed to differ before the comparison fails. */
  readonly maxDiffPixelRatio: number;
  /**
   * Painted opaque black in both images before anything is compared, in the
   * coordinates of the images being compared. A clock, an avatar, or anything
   * else that legitimately changes between runs goes here rather than into a
   * looser threshold, which would blind the whole image instead of one corner.
   */
  readonly mask: readonly PixelBox[];
};

/**
 * Why two images did or did not agree.
 *
 * A size mismatch is its own case rather than a ratio of 1, because nothing
 * about a threshold or a mask can rescue it and the numbers are what say so.
 */
export type Comparison =
  | { readonly kind: 'match'; readonly ratio: number }
  | { readonly kind: 'mismatch'; readonly ratio: number; readonly diff: Buffer }
  | { readonly kind: 'size-mismatch'; readonly expected: Size; readonly actual: Size };

/**
 * The whole of the image comparison, pure over two PNG buffers.
 *
 * The ratio is mismatched pixels over the image's own pixel count, so it
 * carries the same meaning whether the images are a whole device or one
 * cropped button.
 */
export function compareScreenshot(
  expected: Buffer,
  actual: Buffer,
  options: CompareOptions,
): Comparison {
  const before = PNG.sync.read(expected);
  const after = PNG.sync.read(actual);
  if (before.width !== after.width || before.height !== after.height) {
    return {
      kind: 'size-mismatch',
      expected: { width: before.width, height: before.height },
      actual: { width: after.width, height: after.height },
    };
  }
  for (const box of options.mask) {
    paintBlack(before, box);
    paintBlack(after, box);
  }
  const diff = new PNG({ width: before.width, height: before.height });
  const changed = pixelmatch(before.data, after.data, diff.data, before.width, before.height, {
    threshold: options.threshold,
  });
  const ratio = changed / (before.width * before.height);
  if (ratio <= options.maxDiffPixelRatio) return { kind: 'match', ratio };
  return { kind: 'mismatch', ratio, diff: PNG.sync.write(diff) };
}

/**
 * Cuts a region out of a PNG.
 *
 * The box is clamped to the image, because a rect comes from a snapshot and a
 * screenshot is a separate capture: a control flush against the bottom edge
 * can round a pixel past it, and that is not a reason to fail an assertion.
 */
export function cropScreenshot(source: Buffer, box: PixelBox): Buffer {
  const image = PNG.sync.read(source);
  const clamped = clamp(box, { width: image.width, height: image.height });
  const cut = new PNG({ width: clamped.width, height: clamped.height });
  PNG.bitblt(image, cut, clamped.x, clamped.y, clamped.width, clamped.height, 0, 0);
  return PNG.sync.write(cut);
}

export function sizeOf(source: Buffer): Size {
  const image = PNG.sync.read(source);
  return { width: image.width, height: image.height };
}

/**
 * A snapshot rect scaled into image pixels and rounded outward, so a control's
 * own edge is never the thing that gets cut off.
 */
export function toPixelBox(
  rect: { readonly x: number; readonly y: number; readonly width: number; readonly height: number },
  scale: number,
): PixelBox {
  const x = Math.floor(rect.x * scale);
  const y = Math.floor(rect.y * scale);
  return {
    x,
    y,
    width: Math.ceil((rect.x + rect.width) * scale) - x,
    height: Math.ceil((rect.y + rect.height) * scale) - y,
  };
}

/** Moves a box into the coordinates of a crop taken at `origin`. */
export function relativeTo(box: PixelBox, origin: PixelBox): PixelBox {
  return { ...box, x: box.x - origin.x, y: box.y - origin.y };
}

function clamp(box: PixelBox, size: Size): PixelBox {
  const x = Math.min(Math.max(box.x, 0), Math.max(size.width - 1, 0));
  const y = Math.min(Math.max(box.y, 0), Math.max(size.height - 1, 0));
  return {
    x,
    y,
    width: Math.max(Math.min(box.width, size.width - x), 1),
    height: Math.max(Math.min(box.height, size.height - y), 1),
  };
}

function paintBlack(image: PNG, box: PixelBox): void {
  const region = clamp(box, { width: image.width, height: image.height });
  for (let row = region.y; row < region.y + region.height; row += 1) {
    for (let column = region.x; column < region.x + region.width; column += 1) {
      const at = (image.width * row + column) << 2;
      image.data[at] = 0;
      image.data[at + 1] = 0;
      image.data[at + 2] = 0;
      image.data[at + 3] = 255;
    }
  }
}
