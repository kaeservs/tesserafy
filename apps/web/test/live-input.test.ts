/**
 * What the live endpoints accept: a live window is the last few utterances,
 * bounded and redacted before any of it reaches a model or the database;
 * criteria are a scorecard's, not a prompt of any size.
 */
import { describe, expect, it } from 'vitest';
import { LIVE_LIMITS, liveCriteria, liveScorecard, liveWindow, readScreen, redactLive } from '../lib/live-input';

const utterance = (text: string, i = 0) => ({ id: `s${i}`, speaker: 'Dana', startMs: i * 1000, endMs: i * 1000 + 900, text });

describe('a live window', () => {
  it('is redacted like an imported transcript, and keeps its other fields', () => {
    const [segment] = liveWindow<ReturnType<typeof utterance>>([utterance('Mail me at dana@acme.test about the forty thousand.')])!;
    expect(segment!.text).not.toContain('dana@acme.test');
    expect(segment!.text).toContain('forty thousand');
    expect(segment!.startMs).toBe(0);
    expect(redactLive('Call 0161 496 0000')).not.toContain('496 0000');
  });

  it('is refused when it is not the last few utterances', () => {
    expect(liveWindow([])).toBeNull();
    expect(liveWindow('text')).toBeNull();
    expect(liveWindow(Array.from({ length: LIVE_LIMITS.segments + 1 }, (_, i) => utterance('Hi.', i)))).toBeNull();
    expect(liveWindow([utterance('x'.repeat(LIVE_LIMITS.text + 1))])).toBeNull();
    expect(liveWindow([{ ...utterance('Hi.'), speaker: 'x'.repeat(LIVE_LIMITS.speaker + 1) }])).toBeNull();
  });
});

describe('criteria and a scorecard', () => {
  const criterion = { key: 'budget_indicated', label: 'Budget indicated', definition: 'The customer names a budget.' };

  it('are a scorecard’s, within the bounds a scorecard is written to', () => {
    expect(liveCriteria([criterion])).toHaveLength(1);
    expect(liveCriteria([])).toBeNull();
    expect(liveCriteria(Array.from({ length: LIVE_LIMITS.criteria + 1 }, () => criterion))).toBeNull();
    expect(liveCriteria([{ ...criterion, definition: 'x'.repeat(LIVE_LIMITS.definition + 1) }])).toBeNull();
  });

  it('is a scorecard small enough to be one', () => {
    expect(liveScorecard({ criteria: [criterion] })).toBe(true);
    expect(liveScorecard({ criteria: [{ ...criterion, definition: 'x'.repeat(LIVE_LIMITS.scorecard) }] })).toBe(false);
    expect(liveScorecard(null)).toBe(false);
  });
});

describe('a screenshot sent with a question', () => {
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70]).toString('base64');
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString('base64');

  it('is a JPEG or PNG by its first bytes, not by what it says it is', () => {
    expect(readScreen({ mediaType: 'image/jpeg', data: jpeg })).toEqual({ mediaType: 'image/jpeg', data: jpeg });
    expect(readScreen({ mediaType: 'image/png', data: png })).toEqual({ mediaType: 'image/png', data: png });
    expect(readScreen({ mediaType: 'image/jpeg', data: png })).toBe('invalid');
    expect(readScreen({ mediaType: 'image/gif', data: jpeg })).toBe('invalid');
  });

  it('is optional, and never too large', () => {
    expect(readScreen(undefined)).toBeNull();
    expect(readScreen({ mediaType: 'image/jpeg', data: 'A'.repeat(2_000_001) })).toBe('invalid');
  });
});
