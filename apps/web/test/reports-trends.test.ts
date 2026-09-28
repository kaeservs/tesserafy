/**
 * Reports' filters, criteria over time, and customers needing attention.
 * Pinned: a member can never narrow Reports to a colleague; a week with no
 * calls is no rate, not zero; and only open or undecided deals are flagged.
 */
import { describe, expect, it } from 'vitest';
import { accountsNeedingAttention } from '@/lib/accounts-attention';
import type { CoachingCall } from '@/lib/coaching';
import { criteriaTrend } from '@/lib/criteria-trend';
import { filterCalls, parseReportFilters, reportQuery } from '@/lib/report-filters';

const now = new Date('2026-09-30T12:00:00Z');
const OTHER = '11111111-1111-4111-8111-111111111111';

let n = 0;
function call(date: string, over: Partial<CoachingCall> & { met?: string[] } = {}): CoachingCall {
  n += 1;
  const { met = [], ...rest } = over;
  return {
    id: `c${n}`,
    title: `Call ${n}`,
    date: `${date}T10:00:00Z`,
    addedBy: 'me',
    engagementType: 'discovery',
    outcome: null,
    score: 50,
    criteria: ['budget', 'pain'].map((key) => ({ key, label: key === 'budget' ? 'Budget' : 'Pain', status: met.includes(key) ? 'confirmed' : 'unobserved' })),
    accountId: null,
    ...rest,
  };
}

describe('parseReportFilters', () => {
  it('defaults to twelve weeks of everything', () => {
    expect(parseReportFilters({}, { isOwner: true })).toEqual({ weeks: 12, type: null, account: null, seller: null });
  });

  it('lets an owner look at a seller, and a member only at themselves', () => {
    expect(parseReportFilters({ seller: OTHER }, { isOwner: true }).seller).toBe(OTHER);
    expect(parseReportFilters({ seller: OTHER }, { isOwner: false }).seller).toBeNull();
    expect(parseReportFilters({ seller: 'mine' }, { isOwner: false }).seller).toBe('mine');
  });

  it('drops a range it does not offer', () => {
    expect(parseReportFilters({ weeks: '7' }, { isOwner: true }).weeks).toBe(12);
    expect(parseReportFilters({ weeks: '52' }, { isOwner: true }).weeks).toBe(52);
  });

  it('filters by scorecard, customer and seller, and says so in the link', () => {
    const calls = [call('2026-09-28', { accountId: OTHER }), call('2026-09-28', { engagementType: 'demo' }), call('2026-09-28', { addedBy: 'them' })];
    const filters = parseReportFilters({ account: OTHER }, { isOwner: true });
    expect(filterCalls(calls, filters, 'me')).toHaveLength(1);
    expect(filterCalls(calls, parseReportFilters({ type: 'demo' }, { isOwner: true }), 'me')).toHaveLength(1);
    expect(filterCalls(calls, parseReportFilters({ seller: 'mine' }, { isOwner: false }), 'me')).toHaveLength(2);
    expect(reportQuery(filters, { table: 'weeks' })).toBe(`account=${OTHER}&table=weeks`);
  });
});

describe('criteriaTrend', () => {
  it('gives each criterion a rate per week, and none for a week without calls', () => {
    const calls = [call('2026-09-28', { met: ['budget'] }), call('2026-09-29'), call('2026-09-14', { met: ['budget', 'pain'] })];
    const budget = criteriaTrend(calls, now, 3).find((trend) => trend.key === 'budget')!;
    expect(budget.points).toEqual([
      { week: '2026-09-14', calls: 1, rate: 1 },
      { week: '2026-09-21', calls: 0, rate: null },
      { week: '2026-09-28', calls: 2, rate: 0.5 },
    ]);
  });

  it('says how the last four weeks compare with the four before, in points', () => {
    const calls = [
      call('2026-09-28', { met: ['budget'] }),
      call('2026-09-21', { met: ['budget'] }),
      call('2026-08-24'),
      call('2026-08-17', { met: ['budget'] }),
    ];
    expect(criteriaTrend(calls, now, 12).find((trend) => trend.key === 'budget')!.change).toBe(50);
  });

  it('leaves out calls nobody scored', () => {
    const trend = criteriaTrend([call('2026-09-28', { score: null, met: ['budget'] })], now, 4);
    expect(trend).toEqual([]);
  });
});

describe('accountsNeedingAttention', () => {
  const account = (over: Record<string, unknown>) => ({ id: 'a', name: 'A', latestOutcome: 'open', lastCallAt: '2026-09-28T00:00:00Z', lastScore: 70, ...over });

  it('flags an open deal gone quiet, and a last call that went badly', () => {
    const flagged = accountsNeedingAttention(
      [
        account({ name: 'Fine' }),
        account({ name: 'Quiet', lastCallAt: '2026-09-01T00:00:00Z' }),
        account({ name: 'Low', lastScore: 20 }),
        account({ name: 'Won long ago', latestOutcome: 'won', lastCallAt: '2026-06-01T00:00:00Z', lastScore: 10 }),
      ],
      now,
    );
    expect(flagged.map((a) => [a.name, a.reasons])).toEqual([
      ['Quiet', ['quiet']],
      ['Low', ['low score']],
    ]);
  });
});
