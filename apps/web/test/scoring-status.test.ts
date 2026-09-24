import { describe, expect, it } from 'vitest';
import { AUTO_SCORE_MAX_WINDOWS } from '../lib/score-upload';
import { capturedState, SCORING_GRACE_MS, windowCount } from '../lib/scoring-status';

const NOW = new Date('2026-09-24T12:00:00Z');
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();

describe('windowCount', () => {
  it('matches the scoring pass: one window per utterance past the first two', () => {
    expect(windowCount(0)).toBe(0);
    expect(windowCount(2)).toBe(1);
    expect(windowCount(3)).toBe(1);
    expect(windowCount(5)).toBe(3);
    expect(windowCount(150)).toBe(148);
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
    const state = capturedState(AUTO_SCORE_MAX_WINDOWS + 10, ago(1_000), NOW);

    expect(state.kind).toBe('too_long');
    expect(state.kind === 'too_long' && state.windows).toBeGreaterThan(AUTO_SCORE_MAX_WINDOWS);
  });

  it('scores a call exactly at the cap', () => {
    // The boundary is inclusive; off by one here refuses a call the pass takes on.
    const segments = AUTO_SCORE_MAX_WINDOWS + 2;

    expect(windowCount(segments)).toBe(AUTO_SCORE_MAX_WINDOWS);
    expect(capturedState(segments, ago(1_000), NOW).kind).toBe('scoring');
  });
});
