'use server';

import { MIN_PASSWORD } from '@/lib/password';
import { createClient } from '@/lib/supabase/server';
import { inSupportSession } from '@/lib/support-session';

export type PasswordState =
  | { status: 'idle' }
  | { status: 'saved' }
  | { status: 'error'; message: string };

function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === 'string' ? value : '';
}

/**
 * Set or change the signed-in person's password, as them.
 *
 * No key and no admin call: an account may change its own password through
 * its own session, and that is the only account this can reach. It is how an
 * account an operator created — which has no password — becomes one its owner
 * can sign in to again without an emailed link.
 */
export async function setPassword(_prev: PasswordState, formData: FormData): Promise<PasswordState> {
  const password = text(formData, 'password');
  if (password.length < MIN_PASSWORD) {
    return { status: 'error', message: `Use at least ${MIN_PASSWORD} characters.` };
  }
  if (password !== text(formData, 'repeat')) {
    return { status: 'error', message: 'The two passwords are not the same.' };
  }

  const supabase = await createClient();
  // An operator in a support session sees what the customer sees, this form
  // included; a password set there would outlive the visit.
  const { data: session } = await supabase.auth.getSession();
  if (await inSupportSession(supabase, session.session?.access_token)) {
    return { status: 'error', message: 'A support visit cannot change the password. Sign in yourself to change it.' };
  }
  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    return {
      status: 'error',
      message:
        error.code === 'same_password'
          ? 'That is already your password.'
          : error.code === 'weak_password'
            ? 'That password is too easy to guess. Try a longer one.'
            : `That did not work: ${error.message}`,
    };
  }
  return { status: 'saved' };
}
