/**
 * Quote fidelity. These tests are the reason the extractor can be trusted:
 * they pin exactly which model output becomes evidence and which is thrown
 * away for paraphrasing.
 */
import { describe, expect, it } from 'vitest';
import { resolveSignals, type ClaimedSignal } from '../src/tiers/evidence';

const SEGMENTS = [
  {
    id: 'seg-1',
    text: 'Exporting the weekly report takes us most of Friday afternoon.',
  },
  { id: 'seg-2', text: 'We would love to just get it in Slack automatically.' },
];

function claim(overrides: Partial<ClaimedSignal> = {}): ClaimedSignal {
  return {
    kind: 'problem',
    summary: 'The weekly export costs most of a Friday.',
    confidence: 0.8,
    evidence: [{ segment_id: 'seg-1', quote: 'takes us most of Friday afternoon' }],
    ...overrides,
  };
}

describe('resolveSignals', () => {
  it('resolves an exact quote to its offsets', () => {
    const { signals, rejected } = resolveSignals([claim()], SEGMENTS);

    expect(rejected).toHaveLength(0);
    expect(signals[0]?.evidence[0]).toEqual({
      segmentId: 'seg-1',
      quote: 'takes us most of Friday afternoon',
      quoteStart: 28,
      quoteEnd: 61,
    });
  });

  it('stores the segment’s own words, not the model’s copy of them', () => {
    // The offsets are what the database checks, so the two must agree exactly.
    const { signals } = resolveSignals([claim()], SEGMENTS);
    const evidence = signals[0]!.evidence[0]!;

    expect(SEGMENTS[0]!.text.slice(evidence.quoteStart, evidence.quoteEnd)).toBe(evidence.quote);
  });

  it('forgives only whitespace differences', () => {
    const { signals } = resolveSignals(
      [claim({ evidence: [{ segment_id: 'seg-1', quote: 'takes us   most of\nFriday' }] })],
      SEGMENTS,
    );

    expect(signals[0]?.evidence[0]?.quote).toBe('takes us most of Friday');
  });

  it('rejects a paraphrase', () => {
    const { signals, rejected } = resolveSignals(
      [
        claim({
          evidence: [{ segment_id: 'seg-1', quote: 'takes most of our Friday afternoons' }],
        }),
      ],
      SEGMENTS,
    );

    expect(signals).toHaveLength(0);
    expect(rejected[0]).toMatchObject({ reason: 'quote-not-found' });
  });

  it('rejects a quote attributed to the wrong segment', () => {
    const { signals, rejected } = resolveSignals(
      [claim({ evidence: [{ segment_id: 'seg-2', quote: 'takes us most of Friday afternoon' }] })],
      SEGMENTS,
    );

    expect(signals).toHaveLength(0);
    expect(rejected[0]).toMatchObject({ reason: 'quote-not-found' });
  });

  it('rejects an invented segment id', () => {
    const { rejected } = resolveSignals(
      [claim({ evidence: [{ segment_id: 'seg-99', quote: 'anything' }] })],
      SEGMENTS,
    );

    expect(rejected[0]).toMatchObject({ reason: 'unknown-segment' });
  });

  it('rejects a signal with no evidence', () => {
    const { rejected } = resolveSignals([claim({ evidence: [] })], SEGMENTS);

    expect(rejected[0]).toMatchObject({ reason: 'no-evidence' });
  });

  it('rejects a whole signal when one of its quotes is bad', () => {
    // Partial acceptance would leave a signal whose stated support is not the
    // support it actually has.
    const { signals, rejected } = resolveSignals(
      [
        claim({
          evidence: [
            { segment_id: 'seg-1', quote: 'takes us most of Friday afternoon' },
            { segment_id: 'seg-2', quote: 'get it in Teams automatically' },
          ],
        }),
      ],
      SEGMENTS,
    );

    expect(signals).toHaveLength(0);
    expect(rejected[0]).toMatchObject({ reason: 'quote-not-found', quote: expect.any(String) });
  });

  it('rejects an empty summary or an out-of-range confidence', () => {
    const { rejected } = resolveSignals(
      [claim({ summary: '  ' }), claim({ confidence: 1.4 }), claim({ confidence: Number.NaN })],
      SEGMENTS,
    );

    expect(rejected.map((r) => r.reason)).toEqual([
      'empty-summary',
      'confidence-out-of-range',
      'confidence-out-of-range',
    ]);
  });

  it('keeps the good signals when another is rejected', () => {
    const good = claim();
    const bad = claim({ summary: 'Wants Slack', evidence: [{ segment_id: 'seg-2', quote: 'nope' }] });

    const { signals, rejected } = resolveSignals([good, bad], SEGMENTS);

    expect(signals).toHaveLength(1);
    expect(rejected).toHaveLength(1);
  });

  it('resolves multiple quotes across segments', () => {
    const { signals } = resolveSignals(
      [
        claim({
          kind: 'feature_request',
          evidence: [
            { segment_id: 'seg-1', quote: 'Exporting the weekly report' },
            { segment_id: 'seg-2', quote: 'get it in Slack automatically' },
          ],
        }),
      ],
      SEGMENTS,
    );

    expect(signals[0]?.evidence.map((e) => e.segmentId)).toEqual(['seg-1', 'seg-2']);
    expect(signals[0]?.kind).toBe('feature_request');
  });

  it('returns nothing for no claims, which is a valid extraction', () => {
    expect(resolveSignals([], SEGMENTS)).toEqual({ signals: [], rejected: [] });
  });
});
