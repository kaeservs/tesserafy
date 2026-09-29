/**
 * What needs you. Pinned: a goal is measured only with enough calls behind
 * it and listed only when missed, each kind shows a few and counts the rest,
 * and only climbing themes appear.
 */
import { describe, expect, it } from 'vitest';
import type { CoachingCall } from '@/lib/coaching';
import { goalStandings, homeAgenda } from '@/lib/home';
import type { Theme } from '@/lib/themes';

const now = new Date('2026-09-30T12:00:00Z');
let n = 0;
function call(date: string, met: boolean, over: Partial<CoachingCall> = {}): CoachingCall {
  n += 1;
  return {
    id: `c${n}`,
    title: `Call ${n}`,
    date: `${date}T10:00:00Z`,
    addedBy: 'me',
    engagementType: 'discovery',
    outcome: null,
    score: 50,
    criteria: [{ key: 'budget', label: 'Budget indicated', status: met ? 'confirmed' : 'unobserved' }],
    accountId: null,
    ...over,
  };
}
const goal = { engagementType: 'discovery', key: 'budget', target: 0.6 };

describe('goalStandings', () => {
  it('measures the last four weeks of scored calls against the goal', () => {
    const calls = [call('2026-09-29', true), call('2026-09-20', false), call('2026-09-10', false), call('2026-08-01', true)];
    expect(goalStandings(calls, [goal], now)).toEqual([{ ...goal, label: 'Budget indicated', rate: 1 / 3, calls: 3 }]);
  });

  it('says nothing with fewer than three scored calls behind it', () => {
    const calls = [call('2026-09-29', true), call('2026-09-20', false), call('2026-09-21', true, { score: null })];
    expect(goalStandings(calls, [goal], now)).toEqual([]);
  });
});

const theme = (id: string, trend: Theme['trend'], recent: number, previous: number): Theme => ({
  id,
  title: `Theme ${id}`,
  status: 'approved',
  calls: [],
  recent,
  previous,
  trend,
});

describe('homeAgenda', () => {
  it('lists what needs you, missed goals only and climbing themes only', () => {
    const items = homeAgenda({
      assignedToYou: [{ id: 'i1', title: 'Exports are slow' }],
      waitingForDecision: 2,
      customers: [{ id: 'a1', name: 'Acme', reasons: ['quiet'], lastCallAt: '2026-08-31T00:00:00Z', lastScore: 70 }],
      goals: [
        { ...goal, label: 'Budget indicated', rate: 0.2, calls: 5 },
        { engagementType: 'discovery', key: 'pain', target: 0.5, label: 'Pain quantified', rate: 0.8, calls: 5 },
      ],
      themes: [theme('t1', 'rising', 4, 1), theme('t2', 'falling', 1, 3), theme('t3', 'new', 2, 0)],
    });
    expect(items.map((item) => [item.kind, item.text, item.href])).toEqual([
      ['assigned', 'Assigned to you: Exports are slow', '/insights/i1'],
      ['decide', '2 insights waiting for a decision', '/insights?status=proposed'],
      ['customer', 'Acme: deal open, no call since 31 Aug', '/accounts/a1'],
      ['goal', 'Budget indicated met on 20% of 5 calls, against a goal of 60%', '/reports'],
      ['theme', 'Rising: Theme t1, 4 calls in four weeks against 1 before', '/insights/t1'],
      ['theme', 'New theme: Theme t3, 2 calls in four weeks', '/insights/t3'],
    ]);
  });

  it('shows a few customers and counts the rest', () => {
    const customers = Array.from({ length: 5 }, (_, i) => ({
      id: `a${i}`,
      name: `Customer ${i}`,
      reasons: ['low score' as const],
      lastCallAt: '2026-09-28T00:00:00Z',
      lastScore: 20,
    }));
    const items = homeAgenda({ assignedToYou: [], waitingForDecision: 0, customers, goals: [], themes: [] });
    expect(items).toHaveLength(4);
    expect(items[0]!.text).toBe('Customer 0: last call scored 20');
    expect(items[3]).toEqual({ kind: 'customer', text: 'and 2 more customers need attention', href: '/accounts' });
  });

  it('is empty when nothing needs anyone', () => {
    expect(homeAgenda({ assignedToYou: [], waitingForDecision: 0, customers: [], goals: [], themes: [theme('t', 'steady', 1, 1)] })).toEqual([]);
  });
});
