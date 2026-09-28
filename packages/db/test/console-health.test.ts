/**
 * Account health flags and "do companies come back": only what a person
 * should act on is flagged, and retention never claims a week not yet come.
 */
import { describe, expect, it } from 'vitest';
import { byAttention, cohorts, healthFlags, weeklyActive, type HealthRow } from '../src/console-health';

const now = new Date('2026-09-30T12:00:00Z');

function row(over: Partial<HealthRow>): HealthRow {
  return {
    companyId: 'x',
    name: 'X',
    plan: 'basic',
    createdAt: '2026-08-01T00:00:00Z',
    closedAt: null,
    members: 2,
    calls7d: 0,
    calls30d: 0,
    views7d: 0,
    lastCallAt: '2026-09-29T00:00:00Z',
    lastViewAt: null,
    failures7d: 0,
    usage: [{ meter: 'calls', used: 1, limit: 10 }],
    periodEnd: null,
    ...over,
  };
}

describe('healthFlags', () => {
  it('flags nothing for a company doing fine, or one too new to judge', () => {
    expect(healthFlags(row({}), now)).toEqual([]);
    expect(healthFlags(row({ lastCallAt: null, createdAt: '2026-09-28T00:00:00Z' }), now)).toEqual([]);
  });

  it('flags a company that never started, and one that went quiet', () => {
    expect(healthFlags(row({ lastCallAt: null }), now)).toEqual(['not started']);
    expect(healthFlags(row({ lastCallAt: '2026-09-10T00:00:00Z' }), now)).toEqual(['quiet']);
  });

  it('never flags a closed company', () => {
    expect(healthFlags(row({ lastCallAt: null, closedAt: '2026-09-20T00:00:00Z', failures7d: 9 }), now)).toEqual([]);
  });

  it('flags a plan nearly used up, never an unlimited one, and failures', () => {
    expect(healthFlags(row({ usage: [{ meter: 'calls', used: 8, limit: 10 }] }), now)).toEqual(['near its limit']);
    expect(healthFlags(row({ usage: [{ meter: 'calls', used: 80, limit: null }] }), now)).toEqual([]);
    expect(healthFlags(row({ failures7d: 3 }), now)).toEqual(['failing']);
  });
});

describe('byAttention', () => {
  it('puts the companies that need someone first', () => {
    const sorted = byAttention(
      [
        row({ name: 'Fine' }),
        row({ name: 'Quiet and failing', lastCallAt: '2026-09-01T00:00:00Z', failures7d: 5 }),
        row({ name: 'Quiet', lastCallAt: '2026-09-10T00:00:00Z' }),
      ],
      now,
    );
    expect(sorted.map((company) => [company.name, company.flags])).toEqual([
      ['Quiet and failing', ['quiet', 'failing']],
      ['Quiet', ['quiet']],
      ['Fine', []],
    ]);
  });
});

describe('coming back', () => {
  const companies = [
    { companyId: 'a', createdAt: '2026-09-14T10:00:00Z', closedAt: null },
    { companyId: 'b', createdAt: '2026-09-15T10:00:00Z', closedAt: null },
    { companyId: 'c', createdAt: '2026-09-28T10:00:00Z', closedAt: null },
  ];
  const activity = [
    { companyId: 'a', week: '2026-09-14' },
    { companyId: 'b', week: '2026-09-14' },
    { companyId: 'a', week: '2026-09-21' },
    { companyId: 'a', week: '2026-09-28' },
    { companyId: 'c', week: '2026-09-28' },
  ];

  it('counts active companies each week against those that existed', () => {
    expect(weeklyActive(activity, companies, now, 3)).toEqual([
      { week: '2026-09-14', active: 2, existing: 2 },
      { week: '2026-09-21', active: 1, existing: 2 },
      { week: '2026-09-28', active: 2, existing: 3 },
    ]);
  });

  it('shows how much of each starting week is still active after, and nothing for weeks not yet come', () => {
    expect(cohorts(activity, companies, now, 3)).toEqual([
      { week: '2026-09-28', size: 1, retained: [null, null, null] },
      { week: '2026-09-14', size: 2, retained: [0.5, 0.5, null] },
    ]);
  });
});
