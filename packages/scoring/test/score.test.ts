import { describe, expect, it } from 'vitest';
import { defineCriteriaSet, initialState, replay, score } from '../src/index';
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
