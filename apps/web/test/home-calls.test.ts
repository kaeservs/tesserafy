/** The home page's own-calls view: this week, the follow-ups to send, and whose calls count. */
import { describe, expect, it } from 'vitest';
import { callsThisWeek, followUps, myCalls, startOfWeek } from '@/lib/home-calls';

const call = (id: string, date: string, by = 'me', account: string | null = null) => ({
  id,
  title: `Call ${id}`,
  occurred_at: date,
  created_at: date,
  added_by: by,
  account_id: account,
});

const now = new Date('2026-10-08T15:00:00Z'); // a Thursday

describe('home calls', () => {
  it('starts the week on Monday', () => {
    expect(startOfWeek(now).toISOString()).toBe('2026-10-05T00:00:00.000Z');
    expect(startOfWeek(new Date('2026-10-05T00:00:00Z')).toISOString()).toBe('2026-10-05T00:00:00.000Z');
    expect(startOfWeek(new Date('2026-10-11T23:00:00Z')).toISOString()).toBe('2026-10-05T00:00:00.000Z');
  });

  it('counts only the person’s own calls, and only this week’s', () => {
    const mine = myCalls([call('a', '2026-10-06T10:00:00Z'), call('b', '2026-10-01T10:00:00Z'), call('c', '2026-10-07T10:00:00Z', 'them')], 'me');
    expect(mine.map((c) => c.id)).toEqual(['a', 'b']);
    expect(callsThisWeek(mine, now)).toBe(1);
  });

  it('lists recent calls with the undrafted follow-ups first, naming the customer', () => {
    const mine = myCalls(
      [call('a', '2026-10-07T10:00:00Z', 'me', 'acct'), call('b', '2026-10-06T10:00:00Z'), call('c', '2026-10-05T10:00:00Z'), call('old', '2026-09-01T10:00:00Z')],
      'me',
    );
    const rows = followUps(mine, new Set(['a']), new Map([['acct', 'Northwind']]), now);
    expect(rows.map((row) => [row.id, row.drafted])).toEqual([
      ['b', false],
      ['c', false],
      ['a', true],
    ]);
    expect(rows.find((row) => row.id === 'a')?.customer).toBe('Northwind');
  });
});
