'use server';

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

export interface EraseState {
  status: 'idle' | 'error';
  message?: string;
}

function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === 'string' ? value : '';
}

/**
 * Delete a call, as its company's owner.
 *
 * `erase_conversation` does the real work and makes the real decisions: only
 * an owner may, and it removes the call with everything derived from it —
 * segments, embeddings, signals, criterion events, and any insight left
 * without evidence — then writes an erasure record that outlives the call.
 * The typed confirmation here is only friction in front of an irreversible
 * action; the database is what refuses a non-owner.
 *
 * What it cannot reach is anything that already left the product: a ticket
 * exported to GitHub stays in GitHub. The function returns those, and the
 * person is told rather than left to assume "deleted" meant everywhere.
 */
export async function eraseConversation(_prev: EraseState, formData: FormData): Promise<EraseState> {
  const conversationId = text(formData, 'conversationId');
  if (text(formData, 'confirm').trim().toLowerCase() !== 'delete') {
    return { status: 'error', message: 'Type delete to confirm.' };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('erase_conversation', {
    p_conversation_id: conversationId,
    p_reason: 'request',
  });
  if (error) {
    return {
      status: 'error',
      message:
        error.code === '42501'
          ? 'Only an owner of this company can delete a call.'
          : `That did not work: ${error.message}`,
    };
  }

  const result = (data ?? {}) as { exported_tickets?: { url?: string }[] };
  const tickets = (result.exported_tickets ?? []).length;
  // Outside any try/catch: redirect() works by throwing.
  redirect(`/conversations?erased=1${tickets > 0 ? `&tickets=${tickets}` : ''}`);
}
