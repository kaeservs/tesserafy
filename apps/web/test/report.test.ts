import { describe, expect, it } from 'vitest';
import { buildReport, weekStart, type ReportCall } from '../lib/report';

const NOW = new Date('2026-09-30T12:00:00Z'); // a Wednesday; the week began Monday 28 September

const criteria = (confirmed: string[]) =>
  ['pain', 'budget', 'timeline'].map((key) => ({
    key,
    label: key[0]!.toUpperCase() + key.slice(1),
    status: confirmed.includes(key) ? 'confirmed' : 'unobserved',
  }));

function call(date: string, addedBy: string | null, score: number | null, confirmed: string[] = []): ReportCall {
  return { date, addedBy, score, criteria: criteria(confirmed) };
}

describe('weekStart', () => {
  it('is the Monday of the week, in UTC', () => {
    expect(weekStart('2026-09-30T12:00:00Z')).toBe('2026-09-28');
    expect(weekStart('2026-09-28T00:00:00Z')).toBe('2026-09-28');
    expect(weekStart('2026-09-27T23:59:59Z')).toBe('2026-09-21'); // Sunday belongs to the week before
  });
});

describe('buildReport', () => {
  it('has twelve weeks, oldest first, ending this week', () => {
    const { weeks } = buildReport([], NOW);
    expect(weeks).toHaveLength(12);
    expect(weeks.at(-1)?.start).toBe('2026-09-28');
    expect(weeks[0]?.start).toBe('2026-07-13');
  });

  it('averages scored calls by week and leaves unscored ones out of the average', () => {
    const { weeks } = buildReport(
      [call('2026-09-29T10:00:00Z', 'a', 60), call('2026-09-30T10:00:00Z', 'a', 40), call('2026-09-30T11:00:00Z', 'a', null)],
      NOW,
    );
    const thisWeek = weeks.at(-1)!;
    expect(thisWeek).toEqual({ start: '2026-09-28', calls: 3, scored: 2, average: 50 });
    expect(weeks[0]?.average).toBeNull();
  });

  it('leaves out calls older than the window', () => {
    const { weeks, sellers } = buildReport([call('2026-01-05T10:00:00Z', 'a', 90)], NOW);
    expect(weeks.every((w) => w.calls === 0)).toBe(true);
    expect(sellers).toEqual([]);
  });

  it('groups by who added the call, unattributed calls included, busiest first', () => {
    const { sellers } = buildReport(
      [call('2026-09-29T10:00:00Z', 'a', 60), call('2026-09-29T11:00:00Z', 'b', 20), call('2026-09-29T12:00:00Z', 'b', 40), call('2026-09-29T13:00:00Z', null, 80)],
      NOW,
    );
    expect(sellers.map((s) => [s.addedBy, s.calls, s.average])).toEqual([
      ['b', 2, 30],
      ['a', 1, 60],
      [null, 1, 80],
    ]);
  });

  it('compares the last four weeks with the four before them', () => {
    const { sellers } = buildReport(
      [call('2026-09-29T10:00:00Z', 'a', 80), call('2026-08-11T10:00:00Z', 'a', 40)],
      NOW,
    );
    expect(sellers[0]).toMatchObject({ recent: 80, previous: 40 });
  });

  it('names the criterion a seller most often leaves unconfirmed, once there are three scored calls', () => {
    const three = [
      call('2026-09-29T10:00:00Z', 'a', 60, ['pain', 'timeline']),
      call('2026-09-29T11:00:00Z', 'a', 60, ['pain', 'timeline']),
      call('2026-09-29T12:00:00Z', 'a', 40, ['pain', 'budget']),
    ];
    expect(buildReport(three, NOW).sellers[0]?.mostMissed).toEqual({ label: 'Budget', confirmedRate: 1 / 3 });
    expect(buildReport(three.slice(0, 2), NOW).sellers[0]?.mostMissed).toBeNull();
  });
});
