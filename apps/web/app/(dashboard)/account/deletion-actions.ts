'use server';

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

export type DeletionState = { status: 'idle' } | { status: 'error'; message: string };

function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === 'string' ? value : '';
}

/**
 * Ask for the signed-in person's account to be deleted, as them.
 *
 * `request_account_deletion` makes every decision: the address typed is
 * theirs, an owner cannot while their company exists, an operator cannot. It
 * takes a member out of their company at once and records the request; the
 * login itself is deleted by an operator, the one place allowed to (ADR 0013).
 * The session ends here, because there is nothing left in the product for it.
 */
export async function requestDeletion(_prev: DeletionState, formData: FormData): Promise<DeletionState> {
  const supabase = await createClient();
  const { error } = await supabase.rpc('request_account_deletion', {
    p_confirm_email: text(formData, 'email'),
  });
  if (error) {
    const message = error.message.replace(/^request_account_deletion: /, '');
    return {
      status: 'error',
      message:
        error.code === '42501'
          ? 'Sign in again, then ask.'
          : `${message.charAt(0).toUpperCase()}${message.slice(1)}.`,
    };
  }
  await supabase.auth.signOut();
  redirect('/login?deleted=1');
}
