import { SCORE_STRIDE, SCORE_WINDOW_SIZE } from '@tesserafy/ai';
import { describe, expect, it } from 'vitest';
import { AUTO_SCORE_MAX_WINDOWS } from '../lib/score-upload';
import { capturedState, SCORING_GRACE_MS, windowCount } from '../lib/scoring-status';

const NOW = new Date('2026-09-24T12:00:00Z');
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();

/** The longest call the automatic pass takes on, in segments. */
const LONGEST = SCORE_WINDOW_SIZE + (AUTO_SCORE_MAX_WINDOWS - 1) * SCORE_STRIDE;

describe('windowCount', () => {
  it('matches the scoring pass: one window up to 48 utterances, then one per 46 more', () => {
    expect(windowCount(0)).toBe(0);
    expect(windowCount(2)).toBe(1);
    expect(windowCount(48)).toBe(1);
    expect(windowCount(49)).toBe(2);
    expect(windowCount(150)).toBe(4);
  });
});

describe('capturedState', () => {
  it('says scoring for a call that has only just arrived', () => {
    expect(capturedState(40, ago(30_000), NOW).kind).toBe('scoring');
  });

  it('stops claiming scoring once a pass has certainly finished or failed', () => {
    // Saying "scoring…" forever would hide a failure behind a promise.
    expect(capturedState(40, ago(SCORING_GRACE_MS + 1), NOW).kind).toBe('not_scored');
  });

  it('says too long, not scoring, for a call over the cap — even a fresh one', () => {
    const state = capturedState(LONGEST + 1, ago(1_000), NOW);

    expect(state.kind).toBe('too_long');
    expect(state.kind === 'too_long' && state.windows).toBeGreaterThan(AUTO_SCORE_MAX_WINDOWS);
  });

  it('scores a call exactly at the cap', () => {
    // The boundary is inclusive; off by one here refuses a call the pass takes on.
    expect(windowCount(LONGEST)).toBe(AUTO_SCORE_MAX_WINDOWS);
    expect(capturedState(LONGEST, ago(1_000), NOW).kind).toBe('scoring');
  });

  it('takes on a call of about three hours', () => {
    expect(LONGEST).toBeGreaterThanOrEqual(1_800);
  });
});
