/**
 * Calendar sync (ADR 0021): a person connects their own Google or Microsoft
 * calendar, read-only, and their upcoming meetings with people outside their
 * company come in as the start of a call prep.
 *
 * Each provider is three calls — the sign-in URL, trading the sign-in code for
 * a refresh token, and reading the next fortnight — with every answer brought
 * to one shape (CalendarEvent) before anything else sees it. What is kept is
 * the least a prep needs: title, time, who, and the meeting link. Descriptions
 * are never read in, and a meeting with nobody from outside the person's own
 * email domain is never kept at all.
 *
 * The app registrations live in this deployment's environment; until they are
 * set, the Account page says calendar sync is not switched on yet.
 */

export const PROVIDERS = ['google', 'microsoft'] as const;
export type CalendarProvider = (typeof PROVIDERS)[number];

export const PROVIDER_NAME: Record<CalendarProvider, string> = { google: 'Google Calendar', microsoft: 'Microsoft Outlook' };

export function isCalendarProvider(value: string): value is CalendarProvider {
  return (PROVIDERS as readonly string[]).includes(value);
}

/** How far ahead a sync reads. */
export const SYNC_DAYS = 14;

export interface Attendee {
  readonly email: string;
  readonly name: string | null;
}

/** A meeting, the same whichever calendar it came from. */
export interface CalendarEvent {
  readonly external_id: string;
  readonly title: string;
  readonly starts_at: string;
  readonly ends_at: string;
  readonly attendees: readonly Attendee[];
  readonly meeting_url: string | null;
}

interface AppConfig {
  readonly clientId: string;
  readonly clientSecret: string;
}

function app(provider: CalendarProvider): AppConfig | null {
  const prefix = provider === 'google' ? 'GOOGLE' : 'MICROSOFT';
  const clientId = process.env[`${prefix}_CLIENT_ID`]?.trim();
  const clientSecret = process.env[`${prefix}_CLIENT_SECRET`]?.trim();
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

/** Whether this deployment can connect this provider: its app is registered and tokens can be sealed. */
export function calendarAvailable(provider: CalendarProvider): boolean {
  return app(provider) !== null && Boolean(process.env['CALENDAR_TOKEN_KEY']);
}

const GOOGLE = {
  authorize: 'https://accounts.google.com/o/oauth2/v2/auth',
  token: 'https://oauth2.googleapis.com/token',
  revoke: 'https://oauth2.googleapis.com/revoke',
  userinfo: 'https://openidconnect.googleapis.com/v1/userinfo',
  events: 'https://www.googleapis.com/calendar/v3/calendars/primary/events',
  // Read-only, and only events: no calendar settings, no other calendars' data.
  scope: 'openid email https://www.googleapis.com/auth/calendar.events.readonly',
};

const MICROSOFT = {
  authorize: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
  token: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
  me: 'https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName',
  calendarView: 'https://graph.microsoft.com/v1.0/me/calendarView',
  scope: 'offline_access openid email User.Read Calendars.Read',
};

/** Where the person is sent to say yes. `state` comes back, so the callback knows it started here. */
export function authorizeUrl(provider: CalendarProvider, redirectUri: string, state: string): string {
  const config = app(provider);
  if (!config) throw new Error(`${PROVIDER_NAME[provider]} is not registered for this deployment`);
  const params = new URLSearchParams({ client_id: config.clientId, redirect_uri: redirectUri, response_type: 'code', state });
  if (provider === 'google') {
    params.set('scope', GOOGLE.scope);
    // A refresh token, and asked for every time: Google gives one only on consent.
    params.set('access_type', 'offline');
    params.set('prompt', 'consent');
    params.set('include_granted_scopes', 'true');
    return `${GOOGLE.authorize}?${params}`;
  }
  params.set('scope', MICROSOFT.scope);
  params.set('response_mode', 'query');
  return `${MICROSOFT.authorize}?${params}`;
}

export type Fetch = typeof fetch;

async function tokenRequest(provider: CalendarProvider, body: Record<string, string>, doFetch: Fetch) {
  const config = app(provider);
  if (!config) throw new Error(`${PROVIDER_NAME[provider]} is not registered for this deployment`);
  const response = await doFetch(provider === 'google' ? GOOGLE.token : MICROSOFT.token, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      ...(provider === 'microsoft' ? { scope: MICROSOFT.scope } : {}),
      ...body,
    }),
  });
  const json = (await response.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; error?: string };
  if (!response.ok || !json.access_token) {
    throw new CalendarRefused(`${PROVIDER_NAME[provider]} said no: ${json.error ?? response.status}`);
  }
  return { accessToken: json.access_token, refreshToken: json.refresh_token ?? null };
}

/** The provider refused: a revoked grant, an expired token, a wrong app. Said to the person, not retried. */
export class CalendarRefused extends Error {
  override readonly name = 'CalendarRefused';
}

/** The sign-in code traded for a refresh token, and which account it is. */
export async function exchangeCode(
  provider: CalendarProvider,
  code: string,
  redirectUri: string,
  doFetch: Fetch = fetch,
): Promise<{ refreshToken: string; email: string }> {
  const { accessToken, refreshToken } = await tokenRequest(provider, { grant_type: 'authorization_code', code, redirect_uri: redirectUri }, doFetch);
  if (!refreshToken) throw new CalendarRefused(`${PROVIDER_NAME[provider]} gave no lasting access; connect again`);
  const response = await doFetch(provider === 'google' ? GOOGLE.userinfo : MICROSOFT.me, { headers: { authorization: `Bearer ${accessToken}` } });
  const who = (await response.json().catch(() => ({}))) as { email?: string; mail?: string | null; userPrincipalName?: string };
  const email = (who.email ?? who.mail ?? who.userPrincipalName ?? '').trim();
  if (!email.includes('@')) throw new CalendarRefused(`${PROVIDER_NAME[provider]} did not say which account this is`);
  return { refreshToken, email };
}

/** A fresh access token, and the new refresh token when the provider rotates it (Microsoft does). */
export async function refreshAccess(provider: CalendarProvider, refreshToken: string, doFetch: Fetch = fetch) {
  return tokenRequest(provider, { grant_type: 'refresh_token', refresh_token: refreshToken }, doFetch);
}

/** Best effort: tell the provider to forget the grant when someone disconnects. */
export async function revoke(provider: CalendarProvider, refreshToken: string, doFetch: Fetch = fetch): Promise<void> {
  // Microsoft has no per-token revoke for this kind of app; the person removes it under their account's app permissions.
  if (provider !== 'google') return;
  await doFetch(`${GOOGLE.revoke}?token=${encodeURIComponent(refreshToken)}`, { method: 'POST' }).catch(() => undefined);
}

interface GoogleEvent {
  id?: string;
  status?: string;
  summary?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  attendees?: { email?: string; displayName?: string; self?: boolean; resource?: boolean }[];
  hangoutLink?: string;
  conferenceData?: { entryPoints?: { entryPointType?: string; uri?: string }[] };
}

interface MicrosoftEvent {
  id?: string;
  isCancelled?: boolean;
  subject?: string;
  start?: { dateTime?: string };
  end?: { dateTime?: string };
  attendees?: { emailAddress?: { address?: string; name?: string }; type?: string }[];
  onlineMeeting?: { joinUrl?: string } | null;
}

/** Microsoft's times, asked for in UTC, come without the Z. */
function utc(value: string | undefined): string | null {
  if (!value) return null;
  const date = new Date(/[zZ]|[+-]\d\d:\d\d$/.test(value) ? value : `${value}Z`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function fromGoogle(item: GoogleEvent): CalendarEvent | null {
  // All-day items (date, no dateTime) are holidays and out-of-office, not calls.
  const start = utc(item.start?.dateTime);
  const end = utc(item.end?.dateTime);
  if (!item.id || item.status === 'cancelled' || !start || !end) return null;
  const video = item.conferenceData?.entryPoints?.find((point) => point.entryPointType === 'video')?.uri;
  return {
    external_id: item.id,
    title: (item.summary ?? '').trim() || '(no title)',
    starts_at: start,
    ends_at: end,
    attendees: (item.attendees ?? [])
      .filter((attendee) => attendee.email && !attendee.self && !attendee.resource)
      .map((attendee) => ({ email: attendee.email!.toLowerCase(), name: attendee.displayName?.trim() || null })),
    meeting_url: video ?? item.hangoutLink ?? null,
  };
}

export function fromMicrosoft(item: MicrosoftEvent, self: string): CalendarEvent | null {
  const start = utc(item.start?.dateTime);
  const end = utc(item.end?.dateTime);
  if (!item.id || item.isCancelled || !start || !end) return null;
  return {
    external_id: item.id,
    title: (item.subject ?? '').trim() || '(no title)',
    starts_at: start,
    ends_at: end,
    attendees: (item.attendees ?? [])
      .filter((attendee) => attendee.type !== 'resource' && attendee.emailAddress?.address)
      .map((attendee) => ({ email: attendee.emailAddress!.address!.toLowerCase(), name: attendee.emailAddress?.name?.trim() || null }))
      .filter((attendee) => attendee.email !== self.toLowerCase()),
    meeting_url: item.onlineMeeting?.joinUrl ?? null,
  };
}

const domainOf = (email: string) => email.slice(email.lastIndexOf('@') + 1).toLowerCase();

/**
 * Only meetings with somebody from outside: an attendee whose domain is not
 * the person's own. Attendees from inside are dropped too — what the prep
 * needs is who the customer is.
 */
export function externalOnly(events: readonly CalendarEvent[], ownEmail: string): CalendarEvent[] {
  const own = domainOf(ownEmail);
  return events.flatMap((event) => {
    const outside = event.attendees.filter((attendee) => domainOf(attendee.email) !== own);
    return outside.length > 0 ? [{ ...event, attendees: outside.slice(0, 50) }] : [];
  });
}

/** The next SYNC_DAYS of the person's primary calendar, as CalendarEvents. */
export async function readEvents(
  provider: CalendarProvider,
  accessToken: string,
  self: string,
  now: Date,
  doFetch: Fetch = fetch,
): Promise<CalendarEvent[]> {
  const from = now.toISOString();
  const to = new Date(now.getTime() + SYNC_DAYS * 86_400_000).toISOString();
  if (provider === 'google') {
    const params = new URLSearchParams({ timeMin: from, timeMax: to, singleEvents: 'true', orderBy: 'startTime', maxResults: '250' });
    const response = await doFetch(`${GOOGLE.events}?${params}`, { headers: { authorization: `Bearer ${accessToken}` } });
    if (!response.ok) throw new CalendarRefused(`Google Calendar said no: ${response.status}`);
    const json = (await response.json()) as { items?: GoogleEvent[] };
    return (json.items ?? []).flatMap((item) => fromGoogle(item) ?? []);
  }
  const params = new URLSearchParams({
    startDateTime: from,
    endDateTime: to,
    $top: '250',
    $select: 'id,subject,start,end,attendees,onlineMeeting,isCancelled',
    $orderby: 'start/dateTime',
  });
  const response = await doFetch(`${MICROSOFT.calendarView}?${params}`, {
    headers: { authorization: `Bearer ${accessToken}`, prefer: 'outlook.timezone="UTC"' },
  });
  if (!response.ok) throw new CalendarRefused(`Microsoft Outlook said no: ${response.status}`);
  const json = (await response.json()) as { value?: MicrosoftEvent[] };
  return (json.value ?? []).flatMap((item) => fromMicrosoft(item, self) ?? []);
}

/** Who a prep from this meeting is with, and which customer, by the attendee's domain. */
export function prepFromEvent(
  event: { attendees: readonly Attendee[] },
  accounts: readonly { id: string; name: string; domain: string | null }[],
): { personName: string; accountId: string | null } {
  const first = event.attendees[0];
  const personName = first?.name || first?.email.split('@')[0] || 'Someone';
  const domain = first ? domainOf(first.email) : '';
  const account = accounts.find((candidate) => candidate.domain && domain && (domain === candidate.domain.toLowerCase() || domain.endsWith(`.${candidate.domain.toLowerCase()}`)));
  return { personName, accountId: account?.id ?? null };
}
