/**
 * The overlay's own rectangle, greyed out of a screenshot of its display.
 *
 * "Ask about your screen" is about what the seller is looking at, and the
 * overlay is not that. On the Incognito plan the system leaves the overlay
 * out of the capture by itself (content protection); on every other plan it
 * was in it, and the model could read the overlay's own text back as "on
 * your screen". Hiding the window for the capture would make it flicker, and
 * turning protection on for a moment would make it vanish briefly from a
 * screen share; painting over its rectangle does neither.
 *
 * Pure: a BGRA bitmap and rectangles in, the same bitmap with the rectangle
 * filled. Electron is the caller's business.
 */

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** The overlay's bounds in the screenshot's pixels: display coordinates scaled to the thumbnail. */
export function overlayInShot(overlay: Rect, display: Rect, shot: { width: number; height: number }): Rect {
  const sx = shot.width / display.width;
  const sy = shot.height / display.height;
  return {
    x: Math.floor((overlay.x - display.x) * sx),
    y: Math.floor((overlay.y - display.y) * sy),
    width: Math.ceil(overlay.width * sx),
    height: Math.ceil(overlay.height * sy),
  };
}

/** Fills the rectangle, clipped to the bitmap, with a flat grey. */
export function maskRect(bitmap: Buffer, width: number, height: number, rect: Rect): Buffer {
  const left = Math.max(0, rect.x);
  const top = Math.max(0, rect.y);
  const right = Math.min(width, rect.x + rect.width);
  const bottom = Math.min(height, rect.y + rect.height);
  for (let y = top; y < bottom; y++) {
    for (let x = left; x < right; x++) {
      const at = (y * width + x) * 4;
      bitmap[at] = 128;
      bitmap[at + 1] = 128;
      bitmap[at + 2] = 128;
      bitmap[at + 3] = 255;
    }
  }
  return bitmap;
}
