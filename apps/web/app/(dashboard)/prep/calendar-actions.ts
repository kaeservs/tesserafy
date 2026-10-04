'use server';

import { redirect } from 'next/navigation';
import { prepForMeeting } from '@/lib/meeting-prep';
import { createClient } from '@/lib/supabase/server';

/**
 * A call prep from a calendar meeting, in one click (lib/meeting-prep). The
 * brief is still a separate press on the prep's page, because writing it
 * spends the plan's allowance and a click here should not.
 */
export async function prepareFromEvent(formData: FormData): Promise<void> {
  const raw = formData.get('eventId');
  const eventId = typeof raw === 'string' && /^[0-9a-f-]{36}$/i.test(raw) ? raw : null;
  if (!eventId) redirect('/prep');
  const prepId = await prepForMeeting(await createClient(), eventId);
  redirect(prepId ? `/prep/${prepId}` : '/prep?calendar=failed');
}
