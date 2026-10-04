/**
 * Calendar sync without a network: each provider's answer brought to one
 * shape, only meetings with someone from outside kept, and a prep's who and
 * customer worked out from the attendee.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { authorizeUrl, exchangeCode, externalOnly, fromGoogle, fromMicrosoft, prepFromEvent, readEvents } from '@/lib/calendar';

beforeEach(() => {
  vi.stubEnv('GOOGLE_CLIENT_ID', 'g-id');
  vi.stubEnv('GOOGLE_CLIENT_SECRET', 'g-secret');
  vi.stubEnv('MICROSOFT_CLIENT_ID', 'm-id');
  vi.stubEnv('MICROSOFT_CLIENT_SECRET', 'm-secret');
});
afterEach(() => vi.unstubAllEnvs());

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('calendar providers', () => {
  it('asks Google for read-only events and a lasting grant, and Microsoft for Calendars.Read', () => {
    const google = new URL(authorizeUrl('google', 'https://app.test/cb', 'st'));
    expect(google.searchParams.get('scope')).toContain('calendar.events.readonly');
    expect(google.searchParams.get('access_type')).toBe('offline');
    expect(google.searchParams.get('state')).toBe('st');
    const microsoft = new URL(authorizeUrl('microsoft', 'https://app.test/cb', 'st'));
    expect(microsoft.searchParams.get('scope')).toBe('offline_access openid email User.Read Calendars.Read');
  });

  it('trades the code for a refresh token and the account it belongs to', async () => {
    const doFetch = vi.fn(async (url: string) =>
      url.includes('token') ? json({ access_token: 'a', refresh_token: 'r' }) : json({ email: 'Seller@Acme.test' }),
    );
    await expect(exchangeCode('google', 'code', 'https://app.test/cb', doFetch as unknown as typeof fetch)).resolves.toEqual({
      refreshToken: 'r',
      email: 'Seller@Acme.test',
    });
  });

  it('reads a Google meeting as one shape, leaving out you, rooms and all-day items', () => {
    expect(
      fromGoogle({
        id: 'g1',
        summary: 'Northwind discovery',
        start: { dateTime: '2026-10-06T15:00:00+02:00' },
        end: { dateTime: '2026-10-06T15:30:00+02:00' },
        attendees: [
          { email: 'me@acme.test', self: true },
          { email: 'Dana@Northwind.test', displayName: 'Dana Whitfield' },
          { email: 'room@resource.calendar.google.com', resource: true },
        ],
        conferenceData: { entryPoints: [{ entryPointType: 'video', uri: 'https://meet.google.com/abc' }] },
      }),
    ).toEqual({
      external_id: 'g1',
      title: 'Northwind discovery',
      starts_at: '2026-10-06T13:00:00.000Z',
      ends_at: '2026-10-06T13:30:00.000Z',
      attendees: [{ email: 'dana@northwind.test', name: 'Dana Whitfield' }],
      meeting_url: 'https://meet.google.com/abc',
    });
    expect(fromGoogle({ id: 'h', start: { date: '2026-10-06' }, end: { date: '2026-10-07' } })).toBeNull();
    expect(fromGoogle({ id: 'c', status: 'cancelled', start: { dateTime: '2026-10-06T15:00:00Z' }, end: { dateTime: '2026-10-06T16:00:00Z' } })).toBeNull();
  });

  it('reads a Microsoft meeting, whose UTC times come without the Z', () => {
    expect(
      fromMicrosoft(
        {
          id: 'm1',
          subject: 'Globex demo',
          start: { dateTime: '2026-10-07T09:00:00.0000000' },
          end: { dateTime: '2026-10-07T09:45:00.0000000' },
          attendees: [
            { emailAddress: { address: 'me@acme.test', name: 'Me' } },
            { emailAddress: { address: 'tom@globex.test', name: 'Tom' } },
          ],
          onlineMeeting: { joinUrl: 'https://teams.microsoft.com/l/meetup-join/x' },
        },
        'me@acme.test',
      ),
    ).toEqual({
      external_id: 'm1',
      title: 'Globex demo',
      starts_at: '2026-10-07T09:00:00.000Z',
      ends_at: '2026-10-07T09:45:00.000Z',
      attendees: [{ email: 'tom@globex.test', name: 'Tom' }],
      meeting_url: 'https://teams.microsoft.com/l/meetup-join/x',
    });
  });

  it('keeps only meetings with someone from outside, and only the people from outside', () => {
    const at = { starts_at: 'x', ends_at: 'y', meeting_url: null, title: 't' };
    const kept = externalOnly(
      [
        { ...at, external_id: 'standup', attendees: [{ email: 'colleague@acme.test', name: null }] },
        { ...at, external_id: 'call', attendees: [{ email: 'colleague@acme.test', name: null }, { email: 'dana@northwind.test', name: 'Dana' }] },
        { ...at, external_id: 'solo', attendees: [] },
      ],
      'me@acme.test',
    );
    expect(kept.map((event) => [event.external_id, event.attendees.map((a) => a.email)])).toEqual([['call', ['dana@northwind.test']]]);
  });

  it('reads the next fortnight from Google, and says so when Google refuses', async () => {
    const doFetch = vi.fn(async () => json({ items: [{ id: 'g1', start: { dateTime: '2026-10-06T13:00:00Z' }, end: { dateTime: '2026-10-06T14:00:00Z' }, attendees: [] }] }));
    const events = await readEvents('google', 'token', 'me@acme.test', new Date('2026-10-05T00:00:00Z'), doFetch as unknown as typeof fetch);
    expect(events).toHaveLength(1);
    const asked = new URL(String((doFetch.mock.calls[0] as unknown[])[0]));
    expect(asked.searchParams.get('timeMax')).toBe('2026-10-19T00:00:00.000Z');
    await expect(readEvents('google', 'token', 'me@acme.test', new Date(), (async () => json({}, 401)) as unknown as typeof fetch)).rejects.toThrow(/said no: 401/);
  });

  it('makes a prep with the first person from outside, and their customer by domain', () => {
    const accounts = [
      { id: 'a1', name: 'Northwind Traders', domain: 'northwind.test' },
      { id: 'a2', name: 'Globex', domain: null },
    ];
    expect(prepFromEvent({ attendees: [{ email: 'dana@eu.northwind.test', name: 'Dana Whitfield' }] }, accounts)).toEqual({
      personName: 'Dana Whitfield',
      accountId: 'a1',
    });
    expect(prepFromEvent({ attendees: [{ email: 'sam@unknown.test', name: null }] }, accounts)).toEqual({ personName: 'sam', accountId: null });
  });
});
