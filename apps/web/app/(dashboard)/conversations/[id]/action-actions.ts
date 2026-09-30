'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';

/** Tick an action item done, or not. Anyone in the company; the database checks. */
export async function toggleActionItem(formData: FormData): Promise<void> {
  const id = formData.get('itemId');
  const conversationId = formData.get('conversationId');
  if (typeof id !== 'string' || typeof conversationId !== 'string') return;
  const supabase = await createClient();
  const { error } = await supabase.rpc('set_action_item_done', { p_item_id: id, p_done: formData.get('done') === 'yes' });
  if (error) throw new Error(error.message.replace(/^[a-z_]+: /, ''));
  revalidatePath(`/conversations/${conversationId}`);
  revalidatePath('/dashboard');
}
