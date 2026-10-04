/**
 * The overlay's settings, decided in the dashboard: the next call is the prep
 * chosen, or the person's own whose call is nearest within the window; the
 * look is always one the overlay knows; the call so far is bounded from its
 * newest end and redacted.
 */
import { describe, expect, it } from 'vitest';
import { liveTranscript, TRANSCRIPT_CHARS } from '../lib/live-input';
import { nearestPrep, nextMeeting } from '../lib/live-setup';
import { DEFAULT_LOOK, readLook } from '../lib/overlay-look';

const now = new Date('2026-10-05T10:00:00Z');
const at = (hours: number) => ({ call_at: new Date(now.getTime() + hours * 3_600_000).toISOString() });

describe('the next call, when none is chosen', () => {
  it('is the nearest call from two hours ago to twelve hours ahead', () => {
    expect(nearestPrep([at(5), at(1), at(-1.5)], now)).toEqual(at(1));
    expect(nearestPrep([at(-3), at(13)], now)).toBeNull();
    expect(nearestPrep([{ call_at: null }], now)).toBeNull();
  });
});

describe('how the overlay looks', () => {
  it('keeps what the overlay knows and falls back for the rest', () => {
    expect(readLook({ theme: 'light', accent: 'neon', opacity: 10, size: 'large' })).toEqual({
      theme: 'light',
      accent: DEFAULT_LOOK.accent,
      opacity: 35,
      size: 'large',
    });
    expect(readLook(null)).toEqual(DEFAULT_LOOK);
  });
});

describe('the call so far', () => {
  it('keeps the newest words when the call is long, and redacts them', () => {
    const long = Array.from({ length: 30 }, (_, i) => ({ id: `u${i}`, speaker: 'Dana', text: `${i} `.padEnd(1_500, 'x') }));
    const kept = liveTranscript<(typeof long)[number]>([...long, { id: 'last', speaker: 'Dana', text: 'Mail dana@acme.test.' }])!;
    expect(kept.at(-1)!.text).not.toContain('dana@acme.test');
    expect(kept.at(-1)!.id).toBe('last');
    expect(kept.reduce((sum, s) => sum + s.text.length, 0)).toBeLessThanOrEqual(TRANSCRIPT_CHARS);
    expect(kept[0]!.id).not.toBe('u0');
  });

  it('is refused when it is not a transcript', () => {
    expect(liveTranscript('text')).toBeNull();
    expect(liveTranscript([{ id: 'u0', speaker: 'Dana', text: 'x'.repeat(5_000) }])).toBeNull();
  });
});

describe('nextMeeting', () => {
  const now = new Date('2026-10-05T10:00:00Z');
  const meeting = (id: string, starts: string, ends: string) => ({ id, starts_at: starts, ends_at: ends });
  it('is the meeting on now, or the soonest starting within half an hour', () => {
    expect(nextMeeting([meeting('later', '2026-10-05T10:20:00Z', '2026-10-05T11:00:00Z'), meeting('now', '2026-10-05T09:45:00Z', '2026-10-05T10:15:00Z')], now)?.id).toBe('now');
    expect(nextMeeting([meeting('soon', '2026-10-05T10:25:00Z', '2026-10-05T11:00:00Z')], now)?.id).toBe('soon');
  });
  it('is none when the only meetings have ended or are more than half an hour away', () => {
    expect(nextMeeting([meeting('over', '2026-10-05T09:00:00Z', '2026-10-05T09:30:00Z'), meeting('far', '2026-10-05T10:45:00Z', '2026-10-05T11:30:00Z')], now)).toBeNull();
  });
});
