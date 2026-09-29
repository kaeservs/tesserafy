'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';

export type FeedbackState = { status: 'idle' } | { status: 'sent' } | { status: 'error'; message: string };

/** Send feedback to the Tesserafy team. send_feedback checks who, how long, and how many today. */
export async function sendFeedback(_prev: FeedbackState, formData: FormData): Promise<FeedbackState> {
  const body = formData.get('body');
  const page = formData.get('page');
  if (typeof body !== 'string' || body.trim().length === 0) {
    return { status: 'error', message: 'Write something first.' };
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc('send_feedback', {
    p_body: body,
    ...(typeof page === 'string' && page.startsWith('/') ? { p_page: page } : {}),
  });
  if (error) return { status: 'error', message: error.message.replace(/^[a-z_]+: /, '') };
  revalidatePath('/feedback');
  return { status: 'sent' };
}
