import { recordFailure } from '@tesserafy/ai';
import type { SupabaseClient } from '@tesserafy/db';
import { CalendarRefused, externalOnly, isCalendarProvider, readEvents, refreshAccess, type Fetch } from './calendar';
import { sealer } from './sealed';

/**
 * Bringing a person's calendars up to date, as them: their connections are
 * read under RLS, each refresh token is opened here and nowhere else, and
 * record_calendar_sync replaces their upcoming meetings. A provider refusing
 * (a revoked grant) is saved on the connection for the Account page to say;
 * anything else is recorded as a failure too, so it reaches `pnpm health`.
 *
 * Called when Prepare or Home loads, only for a calendar not synced in the
 * last STALE_MS, so pages stay quick and providers are not asked every click.
 */

export const calendarBox = sealer('CALENDAR_TOKEN_KEY');

const STALE_MS = 15 * 60_000;

export interface SyncResult {
  readonly provider: string;
  readonly meetings: number | null;
  readonly error: string | null;
}

export async function syncCalendars(
  db: SupabaseClient,
  userId: string,
  options: { force?: boolean; now?: Date; doFetch?: Fetch } = {},
): Promise<SyncResult[]> {
  const now = options.now ?? new Date();
  if (!calendarBox.available()) return [];
  const { data: connections } = await db
    .from('calendar_connections')
    .select('provider, account_email, token_ciphertext, last_synced_at')
    .eq('user_id', userId);
  const due = (connections ?? []).filter(
    (connection) =>
      options.force || !connection.last_synced_at || now.getTime() - new Date(connection.last_synced_at).getTime() > STALE_MS,
  );

  return Promise.all(
    due.map(async (connection): Promise<SyncResult> => {
      const provider = connection.provider;
      if (!isCalendarProvider(provider)) return { provider, meetings: null, error: 'unknown provider' };
      const refreshToken = calendarBox.open(connection.token_ciphertext, userId);
      if (!refreshToken) {
        const error = 'The saved sign-in could not be read; connect again.';
        await db.rpc('record_calendar_sync', { p_provider: provider, p_events: [], p_error: error });
        return { provider, meetings: null, error };
      }
      try {
        const access = await refreshAccess(provider, refreshToken, options.doFetch);
        const events = externalOnly(await readEvents(provider, access.accessToken, connection.account_email, now, options.doFetch), connection.account_email);
        const { data, error } = await db.rpc('record_calendar_sync', {
          p_provider: provider,
          p_events: events.map((event) => ({
            external_id: event.external_id,
            title: event.title,
            starts_at: event.starts_at,
            ends_at: event.ends_at,
            meeting_url: event.meeting_url,
            attendees: event.attendees.map((attendee) => ({ email: attendee.email, name: attendee.name })),
          })),
          // Microsoft hands back a new refresh token each time; the old one stops working.
          ...(access.refreshToken && access.refreshToken !== refreshToken
            ? { p_token_ciphertext: calendarBox.seal(access.refreshToken, userId) }
            : {}),
        });
        if (error) throw new Error(`recording the calendar failed: ${error.message}`, { cause: error });
        return { provider, meetings: data ?? events.length, error: null };
      } catch (cause) {
        const message =
          cause instanceof CalendarRefused ? `${cause.message}. Connect again on your Account page.` : 'The calendar could not be reached just now.';
        if (!(cause instanceof CalendarRefused)) recordFailure(cause, { db, source: 'calendar/sync' });
        await db.rpc('record_calendar_sync', { p_provider: provider, p_events: [], p_error: message.slice(0, 300) });
        return { provider, meetings: null, error: message };
      }
    }),
  );
}
