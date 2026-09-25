'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';

export type RemoveState = { status: 'idle' } | { status: 'error'; message: string };

function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === 'string' ? value : '';
}

/**
 * Remove someone from the company, as its owner.
 *
 * `remove_company_member` makes every decision: only an owner, never
 * yourself, only someone in your own company, and the removal recorded before
 * the membership goes. Their account stays; what they lose, at once, is every
 * call — RLS reads through the membership that is now gone.
 */
export async function removeMember(_prev: RemoveState, formData: FormData): Promise<RemoveState> {
  const supabase = await createClient();
  const { error } = await supabase.rpc('remove_company_member', {
    p_user_id: text(formData, 'userId'),
  });
  if (error) {
    return {
      status: 'error',
      message:
        error.code === '42501'
          ? 'Only an owner can remove someone.'
          : error.message.replace(/^remove_company_member: /, ''),
    };
  }
  revalidatePath('/settings');
  return { status: 'idle' };
}
