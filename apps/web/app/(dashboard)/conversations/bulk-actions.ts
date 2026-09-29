'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';

export type BulkState =
  | { status: 'idle' }
  | { status: 'done'; message: string }
  | { status: 'error'; message: string };

/** Enough for a page of Meetings; a bigger clean-up is several presses, each quick. */
const MAX = 100;

function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Several calls at once: set who they were with, or delete them. Each call
 * goes through the same function as doing it on its own page —
 * edit_conversation (whoever added it, or an owner; logged) and
 * erase_conversation (owners) — so nothing here decides who may. The answer
 * counts what was done and what was refused, rather than stopping at the
 * first refusal.
 */
export async function bulkMeetings(_prev: BulkState, formData: FormData): Promise<BulkState> {
  const ids = [...new Set(formData.getAll('ids').filter((id): id is string => typeof id === 'string' && /^[0-9a-f-]{36}$/i.test(id)))];
  if (ids.length === 0) return { status: 'error', message: 'Choose at least one call.' };
  if (ids.length > MAX) return { status: 'error', message: `Up to ${MAX} calls at a time.` };
  const supabase = await createClient();
  const operation = text(formData, 'operation');

  if (operation === 'account') {
    let accountId = text(formData, 'accountId');
    const newName = text(formData, 'newAccount');
    if (!accountId && newName) {
      const { data, error } = await supabase.rpc('save_account', { p_name: newName });
      if (error) return { status: 'error', message: error.message.replace(/^[a-z_]+: /, '') };
      accountId = data;
    }
    if (!accountId) return { status: 'error', message: 'Choose a customer, or name a new one.' };
    let done = 0;
    let refused = 0;
    for (const id of ids) {
      const { error } = await supabase.rpc('edit_conversation', { p_conversation_id: id, p_account_id: accountId });
      if (error) refused += 1;
      else done += 1;
    }
    revalidatePath('/conversations');
    revalidatePath('/accounts');
    return {
      status: 'done',
      message: `${done} call${done === 1 ? '' : 's'} now with that customer${refused ? `; ${refused} you may not change` : ''}.`,
    };
  }

  if (operation === 'delete') {
    if (text(formData, 'confirm').toLowerCase() !== 'delete') {
      return { status: 'error', message: 'Type delete to confirm.' };
    }
    let done = 0;
    let refused = 0;
    for (const id of ids) {
      const { error } = await supabase.rpc('erase_conversation', { p_conversation_id: id, p_reason: 'request' });
      if (error) refused += 1;
      else done += 1;
    }
    revalidatePath('/conversations');
    revalidatePath('/dashboard');
    return {
      status: 'done',
      message: `${done} call${done === 1 ? '' : 's'} deleted${refused ? `; ${refused} refused (only an owner can delete)` : ''}.`,
    };
  }

  return { status: 'error', message: 'Choose what to do with them.' };
}
