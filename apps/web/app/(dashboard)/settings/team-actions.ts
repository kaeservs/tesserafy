'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';

export type RemoveState = { status: 'idle' } | { status: 'error'; message: string };

export type RequestState =
  | { status: 'idle' }
  | { status: 'sent'; email: string }
  | { status: 'error'; message: string };

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

/**
 * Ask for someone to be added, as an owner.
 *
 * `request_teammate` decides: owners only, a real address, nobody already on
 * the team, one open request per address. It records a request and creates
 * nothing — the account is made in the operator console, the one place
 * allowed to (invariant 3).
 */
export async function requestTeammate(_prev: RequestState, formData: FormData): Promise<RequestState> {
  const email = text(formData, 'email').trim().toLowerCase();
  const supabase = await createClient();
  const note = text(formData, 'note').trim();
  const { error } = await supabase.rpc('request_teammate', {
    p_email: email,
    p_role: text(formData, 'role'),
    // Omitted rather than sent empty: the argument defaults to null.
    ...(note ? { p_note: note } : {}),
  });
  if (error) {
    return {
      status: 'error',
      message:
        error.code === '42501'
          ? 'Only an owner can ask for someone to be added.'
          : error.message.replace(/^request_teammate: /, ''),
    };
  }
  revalidatePath('/settings');
  return { status: 'sent', email };
}
