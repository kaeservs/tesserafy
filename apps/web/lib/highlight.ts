export interface HighlightRange {
  readonly start: number;
  readonly end: number;
}

export interface TextPiece {
  readonly text: string;
  readonly highlighted: boolean;
}

/**
 * Splits a segment's text into highlighted and plain pieces.
 *
 * Two signals often cite the same sentence, and their spans can overlap or
 * touch. Rendering them as separate marks would produce nested or adjacent
 * highlights with a visible seam, so overlapping ranges are merged first.
 *
 * Offsets that do not fit the text are dropped rather than clamped: a range
 * that does not match this text is evidence about some other text, and
 * highlighting an arbitrary neighbouring phrase would be worse than
 * highlighting nothing.
 */
export function splitByHighlights(text: string, ranges: readonly HighlightRange[]): TextPiece[] {
  const valid = ranges
    .filter(
      (range) =>
        Number.isInteger(range.start) &&
        Number.isInteger(range.end) &&
        range.start >= 0 &&
        range.end > range.start &&
        range.end <= text.length,
    )
    .sort((a, b) => a.start - b.start);

  if (valid.length === 0) return [{ text, highlighted: false }];

  const merged: HighlightRange[] = [];
  for (const range of valid) {
    const last = merged[merged.length - 1];
    if (last && range.start <= last.end) {
      merged[merged.length - 1] = { start: last.start, end: Math.max(last.end, range.end) };
    } else {
      merged.push(range);
    }
  }

  const pieces: TextPiece[] = [];
  let cursor = 0;
  for (const range of merged) {
    if (range.start > cursor) {
      pieces.push({ text: text.slice(cursor, range.start), highlighted: false });
    }
    pieces.push({ text: text.slice(range.start, range.end), highlighted: true });
    cursor = range.end;
  }
  if (cursor < text.length) {
    pieces.push({ text: text.slice(cursor), highlighted: false });
  }

  return pieces;
}

/** `01:04` — evidence is always shown with the time it was said. */
export function clock(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}
