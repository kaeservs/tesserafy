'use server';

import { redirect } from 'next/navigation';
import { prepFromEvent } from '@/lib/calendar';
import { createClient } from '@/lib/supabase/server';

/**
 * A call prep from a calendar meeting, in one click: who (the first person
 * from outside), which customer (by their email domain), and when. The brief
 * is still a separate press on the prep's page, because writing it spends the
 * plan's allowance and a click here should not.
 */
export async function prepareFromEvent(formData: FormData): Promise<void> {
  const raw = formData.get('eventId');
  const eventId = typeof raw === 'string' && /^[0-9a-f-]{36}$/i.test(raw) ? raw : null;
  if (!eventId) redirect('/prep');
  const db = await createClient();
  const [{ data: event }, { data: accounts }] = await Promise.all([
    db.from('calendar_events').select('id, starts_at, attendees, prep_id').eq('id', eventId).maybeSingle(),
    db.from('accounts').select('id, name, domain').limit(1000),
  ]);
  if (!event) redirect('/prep');
  if (event.prep_id) redirect(`/prep/${event.prep_id}`);

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
  if (error || !prepId) redirect('/prep?calendar=failed');
  await db.rpc('link_calendar_event', { p_event_id: event.id, p_prep_id: prepId });
  redirect(`/prep/${prepId}`);
}
