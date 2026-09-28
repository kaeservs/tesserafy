'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

export type WorkState = { status: 'idle' } | { status: 'saved'; message: string } | { status: 'error'; message: string };

function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === 'string' ? value.trim() : '';
}

function failed(error: { code?: string; message: string }, forbidden: string): WorkState {
  return {
    status: 'error',
    message: error.code === '42501' ? forbidden : error.message.replace(/^(edit_insight|assign_insight|merge_insights|comment_insight): /, ''),
  };
}

/** Title and summary; the evidence behind it is never edited. */
export async function editInsight(_prev: WorkState, formData: FormData): Promise<WorkState> {
  const id = text(formData, 'insightId');
  const supabase = await createClient();
  const { error } = await supabase.rpc('edit_insight', {
    p_insight_id: id,
    p_title: text(formData, 'title'),
    p_summary: text(formData, 'summary'),
  });
  if (error) return failed(error, 'Only a member of this company can change it.');
  revalidatePath(`/insights/${id}`);
  revalidatePath('/insights');
  return { status: 'saved', message: 'Saved.' };
}

/** To a member of the company, or to nobody. The assignee is notified. */
export async function assignInsight(_prev: WorkState, formData: FormData): Promise<WorkState> {
  const id = text(formData, 'insightId');
  const who = text(formData, 'assignee');
  const supabase = await createClient();
  const { error } = await supabase.rpc('assign_insight', { p_insight_id: id, ...(who ? { p_user_id: who } : {}) });
  if (error) return failed(error, 'Only a member of this company can assign it.');
  revalidatePath(`/insights/${id}`);
  revalidatePath('/insights');
  return { status: 'saved', message: who ? 'Assigned.' : 'No longer assigned.' };
}

/** Fold a duplicate into this one, as an owner: its citations join, it goes. */
export async function mergeInsight(_prev: WorkState, formData: FormData): Promise<WorkState> {
  const keep = text(formData, 'insightId');
  const merge = text(formData, 'mergeId');
  if (!merge) return { status: 'error', message: 'Choose the insight to fold in.' };
  const supabase = await createClient();
  const { error } = await supabase.rpc('merge_insights', { p_keep_id: keep, p_merge_id: merge });
  if (error) return failed(error, 'Only an owner can merge insights.');
  revalidatePath('/insights');
  redirect(`/insights/${keep}`);
}

/** A comment in the insight's discussion. */
export async function commentInsight(_prev: WorkState, formData: FormData): Promise<WorkState> {
  const id = text(formData, 'insightId');
  const supabase = await createClient();
  const { error } = await supabase.rpc('comment_insight', { p_insight_id: id, p_body: text(formData, 'body') });
  if (error) return failed(error, 'Only a member of this company can comment.');
  revalidatePath(`/insights/${id}`);
  return { status: 'saved', message: '' };
}
