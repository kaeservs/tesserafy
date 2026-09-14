import { describe, expect, it } from 'vitest';
import { defineCriteriaSet, DEFAULT_THRESHOLDS, type CriteriaSetInput } from '../src/index';

const base: CriteriaSetInput = {
  engagementType: 'discovery',
  version: 1,
  criteria: [{ key: 'problem', label: 'Problem', weight: 1 }],
};

function withCriterion(overrides: Record<string, unknown>): CriteriaSetInput {
  return { ...base, criteria: [{ key: 'problem', label: 'Problem', weight: 1, ...overrides }] };
}

describe('defineCriteriaSet', () => {
  it('applies the ADR 0003 thresholds by default', () => {
    expect(defineCriteriaSet(base).criteria[0]!.thresholds).toEqual({
      candidate: 0.55,
      confirm: 0.8,
      corroboratingSegments: 2,
    });
  });

  it('lets a criterion override some thresholds and keep the rest', () => {
    const set = defineCriteriaSet(withCriterion({ thresholds: { confirm: 0.9 } }));
    expect(set.criteria[0]!.thresholds).toEqual({ ...DEFAULT_THRESHOLDS, confirm: 0.9 });
  });

  it('rejects duplicate keys', () => {
    expect(() =>
      defineCriteriaSet({
        ...base,
        criteria: [
          { key: 'problem', label: 'A', weight: 1 },
          { key: 'problem', label: 'B', weight: 1 },
        ],
      }),
    ).toThrow(/Duplicate/);
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])('rejects weight %s', (weight) => {
    expect(() => defineCriteriaSet(withCriterion({ weight }))).toThrow(/weight/);
  });

  it.each([
    { candidate: 0.9, confirm: 0.8 },
    { candidate: 0, confirm: 0.8 },
    { candidate: 0.5, confirm: 1.2 },
  ])('rejects thresholds %j', (thresholds) => {
    expect(() => defineCriteriaSet(withCriterion({ thresholds }))).toThrow(/thresholds/);
  });

  it('rejects a non-integer corroborating count', () => {
    expect(() =>
      defineCriteriaSet(withCriterion({ thresholds: { corroboratingSegments: 1.5 } })),
    ).toThrow(/corroboratingSegments/);
  });

  it('rejects an empty set and a bad version', () => {
    expect(() => defineCriteriaSet({ ...base, criteria: [] })).toThrow(/at least one/);
    expect(() => defineCriteriaSet({ ...base, version: 0 })).toThrow(/version/);
  });
});
