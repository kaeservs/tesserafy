import { describe, expect, it } from 'vitest';
import { apply, defineCriteriaSet, initialState, replay, type ScorecardState } from '../src/index';
import { contradiction, discovery, evidence, span } from './helpers';

const status = (state: ScorecardState, key: string) => state.criteria[key]!.status;

describe('unobserved', () => {
  it('starts every criterion unobserved', () => {
    const state = initialState(discovery);
    expect(Object.values(state.criteria).map((c) => c.status)).toEqual([
      'unobserved',
      'unobserved',
      'unobserved',
    ]);
    expect(state.transitions).toEqual([]);
  });

  it('ignores evidence below the candidate threshold, returning the same object', () => {
    const state = initialState(discovery);
    expect(apply(state, evidence('problem', 0.54))).toBe(state);
  });

  it('becomes candidate at exactly the candidate threshold', () => {
    const state = apply(initialState(discovery), evidence('problem', 0.55));
    expect(status(state, 'problem')).toBe('candidate');
    expect(state.transitions).toMatchObject([
      { criterionKey: 'problem', from: 'unobserved', to: 'candidate', cause: 'evidence' },
    ]);
  });

  it('stays candidate just under the confirm threshold', () => {
    expect(status(apply(initialState(discovery), evidence('problem', 0.79)), 'problem')).toBe(
      'candidate',
    );
  });

  it('confirms directly on one span at the confirm threshold', () => {
    const state = apply(initialState(discovery), evidence('problem', 0.8));
    expect(status(state, 'problem')).toBe('confirmed');
    expect(state.transitions).toMatchObject([{ from: 'unobserved', to: 'confirmed' }]);
  });
});

describe('candidate -> confirmed by corroboration', () => {
  it('confirms on two spans from different segments', () => {
    const state = replay(discovery, [
      evidence('problem', 0.6, span('seg-1')),
      evidence('problem', 0.6, span('seg-2')),
    ]);
    expect(status(state, 'problem')).toBe('confirmed');
    const confirming = state.transitions.at(-1)!;
    expect(confirming.spans.map((r) => r.span.segmentId)).toEqual(['seg-1', 'seg-2']);
  });

  it('does not confirm on two spans from the same segment', () => {
    const state = replay(discovery, [
      evidence('problem', 0.6, span('seg-1', 1000)),
      evidence('problem', 0.6, span('seg-1', 3000)),
    ]);
    expect(status(state, 'problem')).toBe('candidate');
    expect(state.criteria.problem!.evidence).toHaveLength(2);
  });

  it('counts a re-reported span once', () => {
    const state = replay(discovery, [
      evidence('problem', 0.6, span('seg-1')),
      evidence('problem', 0.6, span('seg-1')),
    ]);
    expect(status(state, 'problem')).toBe('candidate');
    expect(state.criteria.problem!.evidence).toHaveLength(1);
  });

  it('returns the same object for a re-reported span at lower confidence', () => {
    const state = apply(initialState(discovery), evidence('problem', 0.7, span('seg-1')));
    expect(apply(state, evidence('problem', 0.6, span('seg-1')))).toBe(state);
  });

  it('upgrades a re-reported span to its higher confidence, which can confirm', () => {
    const state = replay(discovery, [
      evidence('problem', 0.6, span('seg-1')),
      evidence('problem', 0.85, span('seg-1')),
    ]);
    expect(status(state, 'problem')).toBe('confirmed');
    expect(state.criteria.problem!.evidence).toMatchObject([{ confidence: 0.85, seq: 1 }]);
  });

  it('respects a per-criterion confirm threshold', () => {
    const strict = defineCriteriaSet({
      engagementType: 'strict',
      version: 1,
      criteria: [{ key: 'budget', label: 'Budget', weight: 1, thresholds: { confirm: 0.9 } }],
    });
    expect(status(apply(initialState(strict), evidence('budget', 0.85)), 'budget')).toBe(
      'candidate',
    );
  });
});

describe('confirmed is latching', () => {
  const confirmed = apply(initialState(discovery), evidence('problem', 0.9));

  it('stays confirmed as more evidence arrives, and records it', () => {
    const state = apply(confirmed, evidence('problem', 0.6, span('seg-2')));
    expect(status(state, 'problem')).toBe('confirmed');
    expect(state.criteria.problem!.evidence).toHaveLength(2);
    expect(state.transitions).toHaveLength(1);
  });

  it('is unaffected by events for other criteria', () => {
    const state = replay(discovery, [
      evidence('problem', 0.9),
      evidence('impact', 0.6),
      contradiction('impact', 0.95),
    ]);
    expect(status(state, 'problem')).toBe('confirmed');
  });

  it('ignores a contradiction below the confirm threshold', () => {
    expect(apply(confirmed, contradiction('problem', 0.79))).toBe(confirmed);
  });
});

describe('contradiction', () => {
  it('demotes confirmed to contradicted and records why', () => {
    const state = replay(discovery, [evidence('problem', 0.9), contradiction('problem', 0.85)]);
    expect(status(state, 'problem')).toBe('contradicted');
    expect(state.transitions.at(-1)).toMatchObject({
      from: 'confirmed',
      to: 'contradicted',
      cause: 'contradiction',
      spans: [{ confidence: 0.85, span: { segmentId: 'seg-neg' } }],
    });
  });

  it('demotes candidate to contradicted', () => {
    const state = replay(discovery, [evidence('problem', 0.6), contradiction('problem', 0.85)]);
    expect(status(state, 'problem')).toBe('contradicted');
  });

  it('leaves unobserved alone but keeps the span for the explanation', () => {
    const state = apply(initialState(discovery), contradiction('problem', 0.9));
    expect(status(state, 'problem')).toBe('unobserved');
    expect(state.criteria.problem!.contradictions).toHaveLength(1);
    expect(state.transitions).toEqual([]);
  });

  it('ignores the same contradiction span twice', () => {
    const state = replay(discovery, [evidence('problem', 0.9), contradiction('problem', 0.85)]);
    expect(apply(state, contradiction('problem', 0.95))).toBe(state);
  });

  it('is not overturned by evidence that predates it', () => {
    const state = replay(discovery, [
      evidence('problem', 0.6, span('seg-1')),
      contradiction('problem', 0.85),
      evidence('problem', 0.95, span('seg-1')), // re-report of an older span
    ]);
    expect(status(state, 'problem')).toBe('contradicted');
  });

  it('is overturned by strong fresh evidence', () => {
    const state = replay(discovery, [
      evidence('problem', 0.9, span('seg-1')),
      contradiction('problem', 0.85, span('seg-2')),
      evidence('problem', 0.82, span('seg-3')),
    ]);
    expect(status(state, 'problem')).toBe('confirmed');
    expect(state.transitions.at(-1)).toMatchObject({ from: 'contradicted', to: 'confirmed' });
  });

  it('is not overturned by one weak fresh span', () => {
    const state = replay(discovery, [
      evidence('problem', 0.9, span('seg-1')),
      contradiction('problem', 0.85, span('seg-2')),
      evidence('problem', 0.6, span('seg-3')),
    ]);
    expect(status(state, 'problem')).toBe('contradicted');
  });

  it('is overturned by fresh corroboration from two segments', () => {
    const state = replay(discovery, [
      evidence('problem', 0.9, span('seg-1')),
      contradiction('problem', 0.85, span('seg-2')),
      evidence('problem', 0.6, span('seg-3')),
      evidence('problem', 0.6, span('seg-4')),
    ]);
    expect(status(state, 'problem')).toBe('confirmed');
  });

  it('a later contradiction resets which evidence counts as fresh', () => {
    const state = replay(discovery, [
      evidence('problem', 0.9, span('seg-1')),
      contradiction('problem', 0.85, span('seg-2')),
      evidence('problem', 0.6, span('seg-3')),
      contradiction('problem', 0.85, span('seg-4')),
      evidence('problem', 0.6, span('seg-5')),
    ]);
    expect(status(state, 'problem')).toBe('contradicted');
  });
});

describe('input validation', () => {
  const state = initialState(discovery);

  it('rejects an unknown criterion', () => {
    expect(() => apply(state, evidence('rapport', 0.9))).toThrow(/Unknown criterion "rapport"/);
  });

  it.each([1.01, -0.1, Number.NaN])('rejects confidence %s', (confidence) => {
    expect(() => apply(state, evidence('problem', confidence))).toThrow(RangeError);
  });

  it('rejects a span without a quote (invariant 4)', () => {
    expect(() => apply(state, evidence('problem', 0.9, { ...span('seg-1'), quote: '  ' }))).toThrow(
      /quote/,
    );
  });

  it('rejects a span that ends before it starts', () => {
    expect(() =>
      apply(state, evidence('problem', 0.9, { ...span('seg-1'), startMs: 5000, endMs: 4000 })),
    ).toThrow(RangeError);
  });
});

describe('purity', () => {
  it('never mutates the state it was given', () => {
    const before = replay(discovery, [evidence('problem', 0.6)]);
    const snapshot = JSON.parse(JSON.stringify(before));
    apply(before, evidence('problem', 0.6, span('seg-2')));
    apply(before, contradiction('problem', 0.9));
    expect(before).toEqual(snapshot);
  });

  it('replay equals applying events one at a time', () => {
    const events = [
      evidence('problem', 0.6, span('seg-1')),
      evidence('impact', 0.9),
      evidence('problem', 0.7, span('seg-2')),
      contradiction('impact', 0.85),
    ];
    let stepwise = initialState(discovery);
    for (const e of events) stepwise = apply(stepwise, e);
    expect(replay(discovery, events)).toEqual(stepwise);
  });
});
