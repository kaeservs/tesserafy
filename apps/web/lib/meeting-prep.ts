import type { SupabaseClient } from '@tesserafy/db';
import { prepFromEvent } from './calendar';

/**
 * A call prep from one of the person's calendar meetings (ADR 0021): who (the
 * first person from outside), which customer (by their email domain), and
 * when — or the prep already made from it. As the person, so a meeting that
 * is not theirs is not found. The brief is not written here: that spends the
 * plan's allowance, and making a prep should not.
 *
 * Shared by the Prepare page's button and the overlay's.
 */
export async function prepForMeeting(db: SupabaseClient, eventId: string): Promise<string | null> {
  const [{ data: event }, { data: accounts }] = await Promise.all([
    db.from('calendar_events').select('id, starts_at, attendees, prep_id').eq('id', eventId).maybeSingle(),
    db.from('accounts').select('id, name, domain').limit(1000),
  ]);
  if (!event) return null;
  if (event.prep_id) return event.prep_id;

  const attendees = Array.isArray(event.attendees)
    ? (event.attendees as { email?: unknown; name?: unknown }[]).flatMap((attendee) =>
        typeof attendee.email === 'string' ? [{ email: attendee.email, name: typeof attendee.name === 'string' ? attendee.name : null }] : [],
      )
    : [];
  const { personName, accountId } = prepFromEvent({ attendees }, accounts ?? []);
  const { data: prepId, error } = await db.rpc('save_call_prep', {
    p_person_name: personName.slice(0, 120),
    p_call_at: event.starts_at,
    ...(accountId ? { p_account_id: accountId } : {}),
  });
  if (error || !prepId) return null;
  await db.rpc('link_calendar_event', { p_event_id: event.id, p_prep_id: prepId });
  return prepId;
}
