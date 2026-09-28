/**
 * One person's week. Pinned: the week boundaries (Monday, UTC), looking back
 * and never forward, only colleagues' notes on my calls, and coaching that
 * stays quiet until there is enough to say.
 */
import { describe, expect, it } from 'vitest';
import type { CoachingCall } from '@/lib/coaching';
import { weeklySummary } from '@/lib/weekly';

let n = 0;
function call(date: string, addedBy: string, score: number | null, over: Partial<CoachingCall> = {}): CoachingCall {
  n += 1;
  return {
    id: `c${n}`,
    title: `Call ${n}`,
    date: `${date}T10:00:00Z`,
    addedBy,
    engagementType: 'discovery',
    outcome: null,
    score,
    criteria: [],
    ...over,
  };
}

// Wednesday 30 September 2026; the week began Monday the 28th.
const now = new Date('2026-09-30T12:00:00Z');

describe('weeklySummary', () => {
  const calls = [
    call('2026-09-28', 'me', 60, { outcome: 'won' }),
    call('2026-09-30', 'me', 80),
    call('2026-09-29', 'colleague', 40),
    call('2026-09-27', 'me', 20), // Sunday: last week
    call('2026-09-22', 'me', 40),
  ];

  it('is this week by default, Monday to Sunday in UTC', () => {
    const week = weeklySummary({ userId: 'me', calls, notes: [], insights: [], now });
    expect(week).toMatchObject({ week: '2026-09-28', previousWeek: '2026-09-21', nextWeek: null });
    expect(week.mine.calls.map((c) => c.date.slice(0, 10))).toEqual(['2026-09-30', '2026-09-28']);
    expect(week.mine).toMatchObject({ average: 70, previousAverage: 30, won: 1, lost: 0 });
    expect(week.company).toEqual({ calls: 3, average: 60 });
  });

  it('looks back a week when asked, and never ahead of now', () => {
    const last = weeklySummary({ userId: 'me', calls, notes: [], insights: [], now, week: '2026-09-23' });
    expect(last).toMatchObject({ week: '2026-09-21', nextWeek: '2026-09-28' });
    expect(last.mine.calls).toHaveLength(2);
    expect(weeklySummary({ userId: 'me', calls, notes: [], insights: [], now, week: '2027-01-01' }).week).toBe('2026-09-28');
    expect(weeklySummary({ userId: 'me', calls, notes: [], insights: [], now, week: 'nonsense' }).week).toBe('2026-09-28');
  });

  it('shows colleagues’ notes on my calls this week, not my own or on others’', () => {
    const note = (author: string, addedBy: string, at: string) => ({
      body: `${author} on ${addedBy}`,
      author,
      conversationId: 'c1',
      segmentId: 's1',
      at: `${at}T09:00:00Z`,
      conversationAddedBy: addedBy,
    });
    const week = weeklySummary({
      userId: 'me',
      calls,
      notes: [
        note('coach', 'me', '2026-09-29'),
        note('me', 'me', '2026-09-29'),
        note('coach', 'colleague', '2026-09-29'),
        note('coach', 'me', '2026-09-20'),
      ],
      insights: [],
      now,
    });
    expect(week.notesOnMine.map((note) => note.body)).toEqual(['coach on me']);
  });

  it('lists insights waiting now, and those approved this week', () => {
    const week = weeklySummary({
      userId: 'me',
      calls,
      notes: [],
      now,
      insights: [
        { id: 'i1', title: 'Waiting', status: 'proposed', createdAt: '2026-09-01T00:00:00Z', decidedAt: null },
        { id: 'i2', title: 'Approved now', status: 'approved', createdAt: '2026-09-01T00:00:00Z', decidedAt: '2026-09-29T00:00:00Z' },
        { id: 'i3', title: 'Approved before', status: 'approved', createdAt: '2026-09-01T00:00:00Z', decidedAt: '2026-09-10T00:00:00Z' },
      ],
    });
    expect(week.insightsWaiting.map((i) => i.title)).toEqual(['Waiting']);
    expect(week.insightsApproved.map((i) => i.title)).toEqual(['Approved now']);
  });

  it('says nothing about coaching until there is enough to say', () => {
    const week = weeklySummary({ userId: 'me', calls, notes: [], insights: [], now });
    expect(week.focus).toBeNull();
    expect(week.winning).toBeNull();
  });

  it('names the criterion I trail the company on, and the one that goes with wins', () => {
    const criteria = (met: string[]) =>
      ['next', 'pain'].map((key) => ({ key, label: key === 'next' ? 'Next step' : 'Pain', status: met.includes(key) ? 'confirmed' : 'unobserved' }));
    const coached = [
      call('2026-09-28', 'me', 50, { criteria: criteria(['pain']), outcome: 'lost' }),
      call('2026-09-21', 'me', 50, { criteria: criteria(['pain']), outcome: 'lost' }),
      call('2026-09-14', 'me', 50, { criteria: criteria(['pain']), outcome: 'lost' }),
      call('2026-09-28', 'colleague', 100, { criteria: criteria(['pain', 'next']), outcome: 'won' }),
      call('2026-09-21', 'colleague', 100, { criteria: criteria(['pain', 'next']), outcome: 'won' }),
      call('2026-09-14', 'colleague', 100, { criteria: criteria(['pain', 'next']), outcome: 'won' }),
    ];
    const week = weeklySummary({ userId: 'me', calls: coached, notes: [], insights: [], now });
    expect(week.focus).toEqual({ label: 'Next step', rate: 0, companyRate: 0.5 });
    expect(week.winning).toEqual({ label: 'Next step', wonRate: 1, lostRate: 0 });
  });
});
