'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { isCalendarProvider, revoke } from '@/lib/calendar';
import { calendarBox, syncCalendars } from '@/lib/calendar-sync';
import { createClient } from '@/lib/supabase/server';

function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === 'string' ? value : '';
}

/** Disconnect a calendar: tell the provider to forget the grant, then remove it and its meetings. */
export async function disconnectCalendar(formData: FormData): Promise<void> {
  const provider = text(formData, 'provider');
  if (!isCalendarProvider(provider)) return;
  const db = await createClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) redirect('/login');
  const { data: connection } = await db
    .from('calendar_connections')
    .select('token_ciphertext')
    .eq('user_id', user.id)
    .eq('provider', provider)
    .maybeSingle();
  if (connection && calendarBox.available()) {
    const token = calendarBox.open(connection.token_ciphertext, user.id);
    if (token) await revoke(provider, token);
  }
  await db.rpc('disconnect_calendar', { p_provider: provider });
  revalidatePath('/account');
  redirect('/account?calendar=disconnected#calendar-heading');
}

/** Read the calendars again now, rather than waiting for the next page to. */
export async function syncCalendarNow(): Promise<void> {
  const db = await createClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) redirect('/login');
  await syncCalendars(db, user.id, { force: true });
  revalidatePath('/account');
  redirect('/account?calendar=synced#calendar-heading');
}
