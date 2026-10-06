import { calendarAvailable, PROVIDER_NAME, PROVIDERS, SYNC_DAYS } from '@/lib/calendar';
import { createClient } from '@/lib/supabase/server';
import { disconnectCalendar, syncCalendarNow } from '../calendar-actions';

export const metadata = { title: 'Calendar · Tesserafy' };

const CALENDAR_NOTE: Record<string, string> = {
  connected: 'Calendar connected. Your upcoming customer meetings are on Prepare.',
  disconnected: 'Calendar disconnected, and the meetings it brought in removed.',
  synced: 'Read again.',
  declined: 'Nothing was connected: the permission was not given.',
  expired: 'That took too long or came from somewhere else. Try connecting again.',
  failed: 'Connecting did not work. Try again in a moment.',
  unavailable: 'Calendar sync is not switched on for this deployment yet.',
};

/** Each person's own calendar (ADR 0021): read-only, and only meetings with customers are kept. */
export default async function CalendarPage({ searchParams }: { searchParams: Promise<{ calendar?: string }> }) {
  const { calendar: calendarNote } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: calendars } = user
    ? await supabase.from('calendar_connections').select('provider, account_email, last_synced_at, last_error').eq('user_id', user.id)
    : { data: [] };

  return (
    <section aria-labelledby="calendar-heading" className="card">
      <h2 id="calendar-heading" style={{ marginTop: 0 }}>
        Calendar
      </h2>
      <p className="muted">
        Connect your calendar and your upcoming meetings with customers appear on Prepare and Home, one click from a call
        prep. Read-only. Only meetings with someone outside {user?.email?.split('@')[1] ?? 'your company'} are kept — the
        title, time, who and the meeting link, for the next {SYNC_DAYS} days. Descriptions are never read.
      </p>
      {calendarNote ? <p role="status">{CALENDAR_NOTE[calendarNote] ?? null}</p> : null}
      <ul className="calendar-list">
        {PROVIDERS.map((provider) => {
          const connected = (calendars ?? []).find((row) => row.provider === provider);
          return (
            <li key={provider}>
              <strong>{PROVIDER_NAME[provider]}</strong>{' '}
              {connected ? (
                <>
                  <span className="pill pill-on">Connected</span>{' '}
                  <span className="muted">
                    {connected.account_email}
                    {connected.last_synced_at
                      ? ` · read ${new Date(connected.last_synced_at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' })} UTC`
                      : ''}
                  </span>
                  {connected.last_error ? <p role="alert">{connected.last_error}</p> : null}
                  <form action={disconnectCalendar} className="inline-form">
                    <input type="hidden" name="provider" value={provider} />
                    <button type="submit" className="link-button">
                      Disconnect
                    </button>
                  </form>
                </>
              ) : calendarAvailable(provider) ? (
                <a href={`/api/calendar/connect/${provider}`} className="button-secondary">
                  Connect
                </a>
              ) : (
                <span className="muted">Not switched on for this deployment yet.</span>
              )}
            </li>
          );
        })}
      </ul>
      {(calendars ?? []).length > 0 ? (
        <form action={syncCalendarNow}>
          <button type="submit">Read my calendar now</button>
        </form>
      ) : null}
    </section>
  );
}
