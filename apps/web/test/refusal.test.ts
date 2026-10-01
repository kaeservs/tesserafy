/**
 * What a route tells its caller when the database refuses: our functions'
 * own sentences, without their names; never the schema's words.
 */
import type { SupabaseClient } from '@tesserafy/db';
import { describe, expect, it, vi } from 'vitest';
import { refusal } from '@/lib/refusal';

function fakeDb() {
  const rpc = vi.fn().mockResolvedValue({ error: null });
  return { db: { rpc } as unknown as SupabaseClient, rpc };
}

describe('refusal', () => {
  it('passes on a refusal our function wrote, without its name', () => {
    const { db, rpc } = fakeDb();
    expect(refusal({ code: 'P0002', message: 'append_live_segment: that session has ended' }, { db, source: 'test' })).toEqual({
      status: 404,
      message: 'that session has ended',
    });
    expect(refusal({ code: '22023', message: 'start_live_conversation: you are in more than one company' }, { db, source: 'test' }).status).toBe(400);
    expect(refusal({ code: '42501', message: 'record_criterion_events: not a member' }, { db, source: 'test' }).status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('keeps the database\'s own words from the caller, and records them', () => {
    const { db, rpc } = fakeDb();
    const constraint = refusal(
      { code: '23505', message: 'duplicate key value violates unique constraint "segments_conversation_id_start_ms_key"' },
      { db, source: 'test' },
    );
    expect(constraint.status).toBe(502);
    expect(constraint.message).not.toMatch(/segments|constraint/);
    const policy = refusal({ code: '42501', message: 'permission denied for table company_trackers' }, { db, source: 'test' });
    expect(policy.message).not.toMatch(/company_trackers/);
    const unknown = refusal({ code: '57014', message: 'canceling statement due to statement timeout' }, { db, source: 'test' });
    expect(unknown.status).toBe(502);
    expect(rpc).toHaveBeenCalledTimes(3);
  });
});
