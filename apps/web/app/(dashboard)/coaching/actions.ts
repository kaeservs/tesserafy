'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';

export type CoachingState = { status: 'idle' } | { status: 'saved'; message: string } | { status: 'error'; message: string };

function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === 'string' ? value.trim() : '';
}

const reason = (message: string) => message.replace(/^[a-z_]+: /, '');

/** An owner sends a seller a call, or a moment in it, to listen to. */
export async function assignCoaching(_prev: CoachingState, formData: FormData): Promise<CoachingState> {
  const supabase = await createClient();
  const conversationId = text(formData, 'conversationId');
  const segmentId = text(formData, 'segmentId');
  const note = text(formData, 'note');
  const { error } = await supabase.rpc('assign_coaching', {
    p_assigned_to: text(formData, 'assignedTo'),
    p_conversation_id: conversationId,
    ...(segmentId ? { p_segment_id: segmentId } : {}),
    ...(note ? { p_note: note } : {}),
  });
  if (error) return { status: 'error', message: reason(error.message) };
  // Not the call page: nothing on it changes, and re-rendering it (scoring
  // included) made the answer wait many seconds.
  revalidatePath('/coaching');
  return { status: 'saved', message: 'Assigned. They will see it on their dashboard and under Coaching.' };
}

/** The seller marks it done, with a line of reply if they want. */
export async function completeCoaching(_prev: CoachingState, formData: FormData): Promise<CoachingState> {
  const supabase = await createClient();
  const reply = text(formData, 'reply');
  const { error } = await supabase.rpc('complete_coaching', {
    p_assignment_id: text(formData, 'assignmentId'),
    ...(reply ? { p_reply: reply } : {}),
  });
  if (error) return { status: 'error', message: reason(error.message) };
  revalidatePath('/coaching');
  revalidatePath('/dashboard');
  return { status: 'saved', message: 'Marked done.' };
}

export async function withdrawCoaching(formData: FormData): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.rpc('withdraw_coaching', { p_assignment_id: text(formData, 'assignmentId') });
  if (error) throw new Error(reason(error.message));
  revalidatePath('/coaching');
}
