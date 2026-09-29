'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';

/**
 * Marking a speaker as one of yours, and saving a line as an example. The
 * database decides who may (set_our_speaker, save_moment, remove_moment); these
 * pass the form on and say what happened.
 */

export type ActionState = { status: 'idle' } | { status: 'saved'; message: string } | { status: 'error'; message: string };

function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === 'string' ? value.trim() : '';
}

/** The database's reason, without the function's name in front of it. */
function reason(message: string): string {
  return message.replace(/^[a-z_]+: /, '');
}

export async function markSpeaker(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const ours = text(formData, 'ours') === 'yes';
  const { error } = await supabase.rpc('set_our_speaker', { p_name: text(formData, 'speaker'), p_ours: ours });
  if (error) return { status: 'error', message: reason(error.message) };
  revalidatePath(`/conversations/${text(formData, 'conversationId')}`);
  revalidatePath('/reports');
  return { status: 'saved', message: ours ? 'Marked as one of yours on every call.' : 'No longer counted as yours.' };
}

export async function saveExample(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const note = text(formData, 'note');
  const { error } = await supabase.rpc('save_moment', {
    p_segment_id: text(formData, 'segmentId'),
    p_criterion_key: text(formData, 'criterion'),
    ...(note ? { p_note: note } : {}),
  });
  if (error) return { status: 'error', message: reason(error.message) };
  revalidatePath(`/conversations/${text(formData, 'conversationId')}`);
  revalidatePath('/examples');
  return { status: 'saved', message: 'Saved to Examples.' };
}

export async function removeExample(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const { error } = await supabase.rpc('remove_moment', { p_moment_id: text(formData, 'momentId') });
  if (error) return { status: 'error', message: reason(error.message) };
  const conversationId = text(formData, 'conversationId');
  if (conversationId) revalidatePath(`/conversations/${conversationId}`);
  revalidatePath('/examples');
  return { status: 'saved', message: 'Taken out of Examples.' };
}
