'use server';

import { revalidatePath } from 'next/cache';
import { REASON_MIN, withoutPrefix, type FeedbackState } from '@/lib/feedback';
import { createClient } from '@/lib/supabase/server';

function field(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * "Not right" on a call's action item or signal: removed, and the reason kept
 * as an example the feature is shown from then on. Whoever added the call, or
 * an owner, as with correcting a score; the database checks.
 */
async function reject(
  formData: FormData,
  fn: 'reject_action_item' | 'reject_signal',
  idField: 'itemId' | 'signalId',
): Promise<FeedbackState> {
  const id = field(formData, idField);
  const reason = field(formData, 'reason');
  if (!id) return { status: 'error', message: 'That did not say what it was about.' };
  if (reason.length < REASON_MIN) return { status: 'error', message: 'Say why, in a few words.' };
  const supabase = await createClient();
  const { error } =
    fn === 'reject_action_item'
      ? await supabase.rpc('reject_action_item', { p_item_id: id, p_reason: reason })
      : await supabase.rpc('reject_signal', { p_signal_id: id, p_reason: reason });
  if (error) return { status: 'error', message: withoutPrefix(error.message) };
  // The call page is refreshed by the form (NotRight) once this returns.
  revalidatePath('/guidance');
  if (fn === 'reject_action_item') revalidatePath('/dashboard');
  return { status: 'saved' };
}

export async function rejectActionItem(_state: FeedbackState, formData: FormData): Promise<FeedbackState> {
  return reject(formData, 'reject_action_item', 'itemId');
}

export async function rejectSignal(_state: FeedbackState, formData: FormData): Promise<FeedbackState> {
  return reject(formData, 'reject_signal', 'signalId');
}
