import { describe, expect, it } from 'vitest';
import { apply, defineCriteriaSet, initialState, replay, score } from '../src/index';
import { contradiction, discovery, evidence, span } from './helpers';

describe('score', () => {
  it('is 0 before any evidence', () => {
    expect(score(initialState(discovery))).toMatchObject({
      score: 0,
      earnedWeight: 0,
      totalWeight: 4,
    });
  });

  it('weights confirmed criteria: problem (2 of 4) is 50', () => {
    expect(score(replay(discovery, [evidence('problem', 0.9)])).score).toBe(50);
  });

  it('is 100 when everything is confirmed', () => {
    const state = replay(discovery, [
      evidence('problem', 0.9),
      evidence('impact', 0.9),
      evidence('current_solution', 0.9),
    ]);
    expect(score(state).score).toBe(100);
  });

  it('gives candidates nothing', () => {
    expect(score(replay(discovery, [evidence('problem', 0.7)])).score).toBe(0);
  });

  it('gives contradicted criteria nothing', () => {
    const state = replay(discovery, [evidence('problem', 0.9), contradiction('problem', 0.9)]);
    expect(score(state).score).toBe(0);
  });

  it('does not round', () => {
    const thirds = defineCriteriaSet({
      engagementType: 'thirds',
      version: 1,
      criteria: [
        { key: 'a', label: 'A', weight: 1 },
        { key: 'b', label: 'B', weight: 1 },
        { key: 'c', label: 'C', weight: 1 },
      ],
    });
    expect(score(replay(thirds, [evidence('a', 0.9)])).score).toBeCloseTo(33.3333, 4);
  });

  it('explains itself: every criterion, in order, with status, points and evidence', () => {
    const quote = 'Exporting the weekly report takes us most of Friday afternoon.';
    const card = score(
      replay(discovery, [
        evidence('problem', 0.9, span('seg-7', 61000, quote)),
        evidence('impact', 0.6),
      ]),
    );

    expect(card).toMatchObject({ engagementType: 'discovery', criteriaVersion: 1 });
    expect(card.criteria.map((c) => [c.key, c.status, c.earned])).toEqual([
      ['problem', 'confirmed', 2],
      ['impact', 'candidate', 0],
      ['current_solution', 'unobserved', 0],
    ]);
    expect(card.criteria[0]!.evidence[0]!.span).toMatchObject({ quote, startMs: 61000 });
  });
});

describe('what a criterion is still waiting on', () => {
  const set = defineCriteriaSet({
    engagementType: 'discovery',
    version: 1,
    criteria: [
      {
        key: 'pain',
        label: 'Pain',
        weight: 1,
        thresholds: { candidate: 0.5, confirm: 0.9, corroboratingSegments: 2 },
      },
    ],
  });

  function evidence(segmentId: string, confidence: number) {
    return {
      kind: 'evidence' as const,
      criterionKey: 'pain',
      confidence,
      span: { segmentId, startMs: 0, endMs: 1, quote: 'q' },
    };
  }

  it('says nothing has been observed when nothing has', () => {
    const card = score(initialState(set));

    expect(card.criteria[0]!.shortfall).toEqual({
      segments: 0,
      segmentsNeeded: 2,
      bestConfidence: null,
      confirmingConfidence: 0.9,
    });
  });

  it('counts distinct segments, not quotes', () => {
    // Two quotes from one utterance are one observation; corroboration means
    // it was said in more than one place, which is the whole point of the
    // threshold.
    const state = [evidence('s1', 0.6), evidence('s1', 0.7)].reduce(apply, initialState(set));

    expect(score(state).criteria[0]!.shortfall).toMatchObject({
      segments: 1,
      segmentsNeeded: 2,
      bestConfidence: 0.7,
    });
  });

  it('disappears once the criterion is confirmed', () => {
    // A confirmed criterion is waiting on nothing, and saying otherwise would
    // invite somebody to chase evidence they already have.
    const state = [evidence('s1', 0.6), evidence('s2', 0.6)].reduce(apply, initialState(set));

    expect(score(state).criteria[0]!.status).toBe('confirmed');
    expect(score(state).criteria[0]!.shortfall).toBeNull();
  });

  it('survives a contradiction, because a contradiction is not final', () => {
    const state = [
      evidence('s1', 0.95),
      {
        kind: 'contradiction' as const,
        criterionKey: 'pain',
        confidence: 0.95,
        span: { segmentId: 's3', startMs: 0, endMs: 1, quote: 'q' },
      },
    ].reduce(apply, initialState(set));

    expect(state.criteria['pain']!.status).toBe('contradicted');
    expect(score(state).criteria[0]!.shortfall).not.toBeNull();
  });

  it('reports only evidence the engine kept', () => {
    // Anything under the candidate threshold is discarded rather than
    // recorded, so a shortfall never counts evidence the score ignored.
    const state = [evidence('s1', 0.2)].reduce(apply, initialState(set));

    expect(score(state).criteria[0]!.shortfall).toMatchObject({
      segments: 0,
      bestConfidence: null,
    });
  });
});
