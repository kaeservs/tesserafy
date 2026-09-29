/**
 * Which prep the overlay shows for a customer: the call nearest now within
 * twelve hours ago to a week ahead, else the newest written; never one
 * without a brief.
 */
import { describe, expect, it } from 'vitest';
import { pickPrep } from '@/lib/prep';

const now = new Date('2026-09-30T12:00:00Z');
const prep = (id: string, callAt: string | null, brief: unknown = {}, created = '2026-09-01T00:00:00Z') => ({
  id,
  call_at: callAt,
  created_at: created,
  brief,
});

describe('pickPrep', () => {
  it('takes the call nearest now, including one that started a little while ago', () => {
    const picked = pickPrep([prep('next-week', '2026-10-06T12:00:00Z'), prep('just-started', '2026-09-30T11:30:00Z'), prep('tomorrow', '2026-10-01T09:00:00Z')], now);
    expect(picked?.id).toBe('just-started');
  });

  it('skips preps with no brief, and falls back to the newest written', () => {
    const picked = pickPrep(
      [prep('unwritten', '2026-09-30T13:00:00Z', null), prep('old', '2026-08-01T12:00:00Z', {}, '2026-08-01T00:00:00Z'), prep('newer', null, {}, '2026-09-20T00:00:00Z')],
      now,
    );
    expect(picked?.id).toBe('newer');
  });

  it('is nothing when nothing is written', () => {
    expect(pickPrep([prep('unwritten', '2026-09-30T13:00:00Z', null)], now)).toBeNull();
  });
});
