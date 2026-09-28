/**
 * Coaching arithmetic. The cases pinned are the ones that would mislead: a
 * comparison drawn from two calls, an unscored call counted as a miss, a
 * criterion from one scorecard compared with a namesake on another, and an
 * open deal counted as a loss.
 */
import { describe, expect, it } from 'vitest';
import { criteriaByOutcome, MIN_DECIDED, sellerProfile, type CoachingCall } from '@/lib/coaching';

let n = 0;
function call(
  outcome: CoachingCall['outcome'],
  confirmed: string[],
  over: Partial<CoachingCall> = {},
): CoachingCall {
  n += 1;
  return {
    id: `c${n}`,
    title: `Call ${n}`,
    date: `2026-09-${String((n % 28) + 1).padStart(2, '0')}`,
    addedBy: 'ana',
    engagementType: 'discovery',
    outcome,
    score: 50,
    criteria: ['pain', 'budget', 'next'].map((key) => ({
      key,
      label: key.toUpperCase(),
      status: confirmed.includes(key) ? 'confirmed' : 'unobserved',
    })),
    ...over,
  };
}

describe('criteriaByOutcome', () => {
  it('says nothing until both sides have enough decided calls', () => {
    const [only] = criteriaByOutcome([call('won', ['pain']), call('won', ['pain']), call('won', ['pain']), call('lost', [])]);
    expect(only).toMatchObject({ won: 3, lost: 1, enough: false, criteria: [] });
    expect(MIN_DECIDED).toBe(3);
  });

  it('ranks criteria by how much more often they are met on wins', () => {
    const calls = [
      call('won', ['pain', 'next']),
      call('won', ['pain', 'next']),
      call('won', ['next']),
      call('lost', ['pain']),
      call('lost', ['pain']),
      call('lost', []),
    ];
    const [discovery] = criteriaByOutcome(calls);
    expect(discovery!.enough).toBe(true);
    expect(discovery!.criteria.map((c) => [c.key, Math.round(c.gap * 100)])).toEqual([
      ['next', 100],
      ['budget', 0],
      ['pain', 0],
    ]);
  });

  it('leaves out open deals, calls with no outcome, and calls nobody scored', () => {
    const calls = [
      ...[1, 2, 3].map(() => call('won', ['pain'])),
      ...[1, 2, 3].map(() => call('lost', [])),
      call('open', []),
      call(null, []),
      call('lost', [], { score: null }),
    ];
    const [discovery] = criteriaByOutcome(calls);
    expect(discovery).toMatchObject({ won: 3, lost: 3 });
    expect(discovery!.criteria.find((c) => c.key === 'pain')?.lostRate).toBe(0);
  });

  it('compares criteria within a scorecard, never across two', () => {
    const calls = [
      ...[1, 2, 3].map(() => call('won', ['pain'])),
      ...[1, 2, 3].map(() => call('lost', ['pain'], { engagementType: 'demo' })),
    ];
    const result = criteriaByOutcome(calls);
    expect(result.map((r) => [r.engagementType, r.won, r.lost, r.enough])).toEqual([
      ['discovery', 3, 0, false],
      ['demo', 0, 3, false],
    ]);
  });
});

describe('sellerProfile', () => {
  const calls = [
    call('won', ['pain', 'next'], { addedBy: 'ana' }),
    call('won', ['pain', 'next'], { addedBy: 'ana' }),
    call('lost', ['pain'], { addedBy: 'ana' }),
    call(null, [], { addedBy: 'ana', score: null }),
    call('lost', ['next', 'budget'], { addedBy: 'ben', score: 90 }),
    call('open', ['next', 'budget'], { addedBy: 'ben', score: 90 }),
    call('won', ['next', 'budget'], { addedBy: 'ben', score: 90 }),
  ];

  it('counts their calls, outcomes and averages against the company', () => {
    const ana = sellerProfile(calls, 'ana');
    expect(ana).toMatchObject({
      calls: 4,
      scored: 3,
      average: 50,
      outcomes: { won: 2, lost: 1, open: 0, unsaid: 1 },
    });
    expect(ana.companyAverage).toBeCloseTo((50 * 3 + 90 * 3) / 6);
    expect(ana.winRate).toBeCloseTo(2 / 3);
    expect(ana.companyWinRate).toBeCloseTo(3 / 5);
  });

  it('puts the criteria where they trail the company first', () => {
    const ana = sellerProfile(calls, 'ana');
    expect(ana.criteria.map((c) => [c.key, Math.round(c.rate * 100), Math.round(c.companyRate * 100)])).toEqual([
      ['budget', 0, 50],
      ['next', 67, 83],
      ['pain', 100, 50],
    ]);
  });

  it('gives no win rate on fewer than three decided calls', () => {
    expect(sellerProfile([call('won', [], { addedBy: 'cy' }), call('lost', [], { addedBy: 'cy' })], 'cy').winRate).toBeNull();
  });
});
