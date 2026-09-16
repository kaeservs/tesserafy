import { describe, expect, it } from 'vitest';
import { toSegments } from '../src/chunk/segment';
import type { Turn } from '../src/types';

function turn(overrides: Partial<Turn> = {}): Turn {
  return { speaker: 'Grace', startMs: 0, endMs: 1000, text: 'Something said.', ...overrides };
}

describe('toSegments', () => {
  it('merges consecutive cues from the same speaker', () => {
    const segments = toSegments([
      turn({ startMs: 0, endMs: 2000, text: 'Exporting the weekly report' }),
      turn({ startMs: 2100, endMs: 4000, text: 'takes most of Friday.' }),
    ]);

    expect(segments).toHaveLength(1);
    expect(segments[0]).toMatchObject({
      index: 0,
      speaker: 'Grace',
      startMs: 0,
      endMs: 4000,
      text: 'Exporting the weekly report takes most of Friday.',
    });
  });

  it('starts a new segment when the speaker changes', () => {
    const segments = toSegments([
      turn({ speaker: 'Grace', text: 'We lose a day a week.' }),
      turn({ speaker: 'Ada', startMs: 1000, endMs: 2000, text: 'Every week?' }),
    ]);

    expect(segments.map((s) => s.speaker)).toEqual(['Grace', 'Ada']);
    expect(segments.map((s) => s.index)).toEqual([0, 1]);
  });

  it('starts a new segment after a long silence by the same speaker', () => {
    const segments = toSegments(
      [
        turn({ startMs: 0, endMs: 1000, text: 'Let me think.' }),
        turn({ startMs: 30_000, endMs: 31_000, text: 'Actually, there is another one.' }),
      ],
      { maxGapMs: 5000 },
    );

    expect(segments).toHaveLength(2);
  });

  it('splits an over-long turn at a sentence boundary', () => {
    const sentence = 'We export the report every Friday and it takes hours. ';
    const segments = toSegments([turn({ text: sentence.repeat(6).trim(), endMs: 60_000 })], {
      maxChars: 120,
    });

    expect(segments.length).toBeGreaterThan(1);
    for (const segment of segments) {
      expect(segment.text.length).toBeLessThanOrEqual(120);
      // Every piece ends where a sentence ended, not mid-clause.
      expect(segment.text.endsWith('.')).toBe(true);
    }
  });

  it('never cuts a word in half when a word boundary is available', () => {
    const words = 'alpha bravo charlie delta echo foxtrot golf hotel india juliet '.repeat(4);
    const segments = toSegments([turn({ text: words.trim() })], { maxChars: 100 });

    expect(segments.length).toBeGreaterThan(1);
    for (const segment of segments) {
      expect(segment.text).not.toMatch(/^\S*[a-z]-/);
      for (const word of segment.text.split(' ')) {
        expect(words).toContain(word);
      }
    }
  });

  it('preserves the full text across a split', () => {
    const original =
      'One thing at a time. Two of them went missing. Three weeks later it broke. ' +
      'Four people chased it. Five hours a week, gone. Six months of this now.';
    const segments = toSegments([turn({ text: original })], { maxChars: 80 });

    expect(segments.map((s) => s.text).join(' ')).toBe(original);
  });

  it('interpolates timestamps across the pieces of a split turn', () => {
    const segments = toSegments([turn({ startMs: 10_000, endMs: 20_000, text: 'a'.repeat(400) })], {
      maxChars: 100,
    });

    expect(segments[0]?.startMs).toBe(10_000);
    expect(segments.at(-1)?.endMs).toBe(20_000);
    // Monotonic and contiguous: evidence timestamps never overlap or go back.
    for (let i = 1; i < segments.length; i++) {
      expect(segments[i]!.startMs).toBe(segments[i - 1]!.endMs);
    }
  });

  it('numbers segments in transcript order', () => {
    const segments = toSegments([
      turn({ speaker: 'Grace', text: 'One.' }),
      turn({ speaker: 'Ada', startMs: 1000, endMs: 2000, text: 'Two.' }),
      turn({ speaker: 'Grace', startMs: 2000, endMs: 3000, text: 'Three.' }),
    ]);

    expect(segments.map((s) => s.index)).toEqual([0, 1, 2]);
  });

  it('drops empty turns rather than writing empty evidence', () => {
    const segments = toSegments([turn({ text: '   ' }), turn({ startMs: 2000, text: 'Real.' })]);

    expect(segments).toHaveLength(1);
    expect(segments[0]?.text).toBe('Real.');
  });

  it('keeps unattributed turns separate from attributed ones', () => {
    const segments = toSegments([
      turn({ speaker: null, text: 'Unattributed.' }),
      turn({ speaker: 'Grace', startMs: 1000, endMs: 2000, text: 'Attributed.' }),
    ]);

    expect(segments).toHaveLength(2);
  });

  it('rejects a nonsensical budget rather than emitting one-word segments', () => {
    expect(() => toSegments([turn()], { maxChars: 10 })).toThrow(RangeError);
    expect(() => toSegments([turn()], { maxGapMs: -1 })).toThrow(RangeError);
  });

  it('returns nothing for an empty transcript', () => {
    expect(toSegments([])).toEqual([]);
  });
});
