/**
 * A calendar sync without a network or a database: the sealed token is opened
 * for this person only, the fortnight is read, only outside meetings are
 * recorded, a rotated token is sealed again, and a revoked grant is saved on
 * the connection instead of being lost.
 */
import { randomBytes } from 'node:crypto';
import type { SupabaseClient } from '@tesserafy/db';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { calendarBox, syncCalendars } from '@/lib/calendar-sync';

const USER = '00000000-0000-4000-8000-0000000000u1';

beforeEach(() => {
  vi.stubEnv('CALENDAR_TOKEN_KEY', randomBytes(32).toString('base64'));
  vi.stubEnv('MICROSOFT_CLIENT_ID', 'm-id');
  vi.stubEnv('MICROSOFT_CLIENT_SECRET', 'm-secret');
});
afterEach(() => vi.unstubAllEnvs());

function fakeDb(sealedFor: string) {
  const rpc = vi.fn(async (_name: string, _args: Record<string, unknown>) => ({ data: 1, error: null }));
  const connection = { provider: 'microsoft', account_email: 'me@acme.test', token_ciphertext: calendarBox.seal('refresh-1', sealedFor), last_synced_at: null };
  const chain = { select: () => chain, eq: async () => ({ data: [connection], error: null }) };
  return { db: { from: () => chain, rpc } as unknown as SupabaseClient, rpc };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('syncCalendars', () => {
  it('records only outside meetings, and seals a rotated token for this person', async () => {
    const { db, rpc } = fakeDb(USER);
    const doFetch = vi.fn(async (url: string) =>
      url.includes('/token')
        ? json({ access_token: 'access', refresh_token: 'refresh-2' })
        : json({
            value: [
              { id: 'm1', subject: 'Globex demo', start: { dateTime: '2026-10-07T09:00:00' }, end: { dateTime: '2026-10-07T10:00:00' }, attendees: [{ emailAddress: { address: 'tom@globex.test', name: 'Tom' } }] },
              { id: 'm2', subject: 'Standup', start: { dateTime: '2026-10-07T08:00:00' }, end: { dateTime: '2026-10-07T08:15:00' }, attendees: [{ emailAddress: { address: 'kim@acme.test' } }] },
            ],
          }),
    );
    const [result] = await syncCalendars(db, USER, { doFetch: doFetch as unknown as typeof fetch, now: new Date('2026-10-05T00:00:00Z') });
    expect(result).toMatchObject({ provider: 'microsoft', error: null });
    const [, args] = rpc.mock.calls[0]!;
    expect((args['p_events'] as { external_id: string }[]).map((event) => event.external_id)).toEqual(['m1']);
    expect(calendarBox.open(String(args['p_token_ciphertext']), USER)).toBe('refresh-2');
  });

  it('saves a revoked grant on the connection, and does not raise it as an outage', async () => {
    const { db, rpc } = fakeDb(USER);
    const doFetch = vi.fn(async () => json({ error: 'invalid_grant' }, 400));
    const [result] = await syncCalendars(db, USER, { doFetch: doFetch as unknown as typeof fetch });
    expect(result?.error).toMatch(/invalid_grant.*Connect again/);
    expect(rpc).toHaveBeenCalledWith('record_calendar_sync', expect.objectContaining({ p_error: expect.stringMatching(/invalid_grant/) }));
    expect(rpc.mock.calls.some(([name]) => name === 'record_failure')).toBe(false);
  });

  it('cannot open a token sealed for someone else', async () => {
    const { db, rpc } = fakeDb('00000000-0000-4000-8000-0000000000u2');
    const doFetch = vi.fn();
    const [result] = await syncCalendars(db, USER, { doFetch: doFetch as unknown as typeof fetch });
    expect(result?.error).toMatch(/could not be read/);
    expect(doFetch).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith('record_calendar_sync', expect.objectContaining({ p_error: expect.any(String) }));
  });
});
