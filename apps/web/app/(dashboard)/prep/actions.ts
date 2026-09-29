'use server';

import { redact } from '@tesserafy/ingest';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

export type PrepState = { status: 'idle' } | { status: 'saved'; prepId: string } | { status: 'error'; message: string };

function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === 'string' ? value.trim() : '';
}

const reason = (message: string) => message.replace(/^[a-z_]+: /, '');

/**
 * Save a call prep, new or changed. The pasted profile is redacted here, before
 * it is stored or sent anywhere, as a transcript is: email addresses and phone
 * numbers in a profile are the person's, not the brief's.
 */
export async function savePrep(_prev: PrepState, formData: FormData): Promise<PrepState> {
  const supabase = await createClient();
  const profile = text(formData, 'profile');
  const callAt = text(formData, 'callAt');
  let accountId = text(formData, 'accountId');
  const newAccount = text(formData, 'newAccount');
  if (!accountId && newAccount) {
    const { data, error } = await supabase.rpc('save_account', { p_name: newAccount });
    if (error) return { status: 'error', message: reason(error.message) };
    accountId = data;
  }
  const prepId = text(formData, 'prepId');
  const { data, error } = await supabase.rpc('save_call_prep', {
    p_person_name: text(formData, 'name'),
    p_engagement_type: text(formData, 'engagementType') || 'discovery',
    ...(text(formData, 'title') ? { p_person_title: text(formData, 'title') } : {}),
    ...(text(formData, 'linkedin') ? { p_linkedin_url: text(formData, 'linkedin') } : {}),
    ...(profile ? { p_profile_text: redact(profile).text } : {}),
    ...(accountId ? { p_account_id: accountId } : {}),
    ...(callAt && !Number.isNaN(Date.parse(callAt)) ? { p_call_at: new Date(callAt).toISOString() } : {}),
    ...(prepId ? { p_prep_id: prepId } : {}),
  });
  if (error) return { status: 'error', message: reason(error.message) };
  revalidatePath('/prep');
  revalidatePath(`/prep/${data}`);
  return { status: 'saved', prepId: data };
}

export async function deletePrep(formData: FormData): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.rpc('delete_call_prep', { p_prep_id: text(formData, 'prepId') });
  if (error) throw new Error(reason(error.message));
  revalidatePath('/prep');
  redirect('/prep');
}
