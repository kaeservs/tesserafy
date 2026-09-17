import { describe, expect, it } from 'vitest';
import { clock, splitByHighlights } from '../lib/highlight';

const TEXT = 'Exporting the weekly report takes us most of Friday afternoon.';

function rendered(pieces: { text: string; highlighted: boolean }[]): string {
  return pieces.map((p) => (p.highlighted ? `[${p.text}]` : p.text)).join('');
}

describe('splitByHighlights', () => {
  it('returns the text whole when nothing is highlighted', () => {
    expect(splitByHighlights(TEXT, [])).toEqual([{ text: TEXT, highlighted: false }]);
  });

  it('marks one span in place', () => {
    expect(rendered(splitByHighlights(TEXT, [{ start: 28, end: 61 }]))).toBe(
      'Exporting the weekly report [takes us most of Friday afternoon].',
    );
  });

  it('never loses or duplicates a character', () => {
    const pieces = splitByHighlights(TEXT, [
      { start: 0, end: 9 },
      { start: 28, end: 61 },
    ]);

    expect(pieces.map((p) => p.text).join('')).toBe(TEXT);
  });

  it('merges overlapping spans from two signals into one mark', () => {
    // Otherwise the reader sees a seam where two signals quote the same words.
    const pieces = splitByHighlights(TEXT, [
      { start: 28, end: 44 },
      { start: 36, end: 61 },
    ]);

    expect(pieces.filter((p) => p.highlighted)).toHaveLength(1);
    expect(rendered(pieces)).toBe('Exporting the weekly report [takes us most of Friday afternoon].');
  });

  it('merges touching spans', () => {
    const pieces = splitByHighlights(TEXT, [
      { start: 0, end: 27 },
      { start: 27, end: 44 },
    ]);

    expect(pieces.filter((p) => p.highlighted)).toHaveLength(1);
  });

  it('orders spans given out of order', () => {
    expect(
      rendered(
        splitByHighlights(TEXT, [
          { start: 45, end: 61 },
          { start: 0, end: 9 },
        ]),
      ),
    ).toBe('[Exporting] the weekly report takes us most of [Friday afternoon].');
  });

  it('drops a range that does not fit the text rather than clamping it', () => {
    // A range past the end belongs to different text; highlighting a
    // neighbouring phrase instead would be worse than highlighting nothing.
    expect(splitByHighlights(TEXT, [{ start: 40, end: 4000 }])).toEqual([
      { text: TEXT, highlighted: false },
    ]);
    expect(splitByHighlights(TEXT, [{ start: -2, end: 10 }])).toEqual([
      { text: TEXT, highlighted: false },
    ]);
    expect(splitByHighlights(TEXT, [{ start: 10, end: 10 }])).toEqual([
      { text: TEXT, highlighted: false },
    ]);
  });

  it('keeps the good ranges when one is dropped', () => {
    expect(rendered(splitByHighlights(TEXT, [{ start: 0, end: 9 }, { start: 0, end: 9000 }]))).toBe(
      '[Exporting] the weekly report takes us most of Friday afternoon.',
    );
  });

  it('handles a span that covers the whole text', () => {
    expect(splitByHighlights(TEXT, [{ start: 0, end: TEXT.length }])).toEqual([
      { text: TEXT, highlighted: true },
    ]);
  });
});

describe('clock', () => {
  it('formats milliseconds as mm:ss', () => {
    expect(clock(0)).toBe('00:00');
    expect(clock(61_000)).toBe('01:01');
    expect(clock(3_725_000)).toBe('62:05');
  });

  it('never renders a negative time', () => {
    expect(clock(-5)).toBe('00:00');
  });
});
