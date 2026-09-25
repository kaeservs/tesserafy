'use server';

import { headers } from 'next/headers';
import { MIN_PASSWORD } from '@/lib/password';
import { createClient } from '@/lib/supabase/server';
import { createSignInClient } from '@/lib/supabase/sign-in';

export type SignupState =
  | { status: 'idle' }
  | { status: 'sent'; email: string }
  | { status: 'error'; message: string };

function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === 'string' ? value : '';
}

/**
 * Create an account, which then has to be confirmed by email.
 *
 * The account alone gives nothing: no company, no trial, no data. Those come
 * after the address is confirmed, from `create_my_company`, which is where the
 * real gate is — the switch is checked there as well as here, because Supabase
 * Auth would accept a sign-up sent straight to it whatever this page said.
 *
 * The answer is the same whether or not the address already has an account,
 * so the form cannot be used to find out who the customers are. Supabase
 * sends nothing to an address that is already registered.
 */
export async function signUp(_prev: SignupState, formData: FormData): Promise<SignupState> {
  const supabase = await createClient();
  const { data: open } = await supabase.rpc('signup_is_open');
  if (open !== true) return { status: 'error', message: 'Sign-up is not open yet.' };

  const email = text(formData, 'email').trim().toLowerCase();
  const password = text(formData, 'password');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return { status: 'error', message: 'Enter your work email address.' };
  }
  if (password.length < MIN_PASSWORD) {
    return { status: 'error', message: `Use a password of at least ${MIN_PASSWORD} characters.` };
  }

  const origin = (await headers()).get('origin');
  if (!origin) return { status: 'error', message: 'Could not determine the site address.' };

  // The implicit flow, as the emailed sign-in links use: the confirmation
  // lands on /auth/confirm with the session in the fragment, and works in
  // whichever browser the email is opened in.
  const auth = await createSignInClient();
  const { error } = await auth.auth.signUp({
    email,
    password,
    options: { emailRedirectTo: `${origin}/auth/confirm` },
  });
  if (error) {
    if (error.code === 'weak_password') {
      return { status: 'error', message: 'That password is too easy to guess. Try a longer one.' };
    }
    if (error.status === 429 || error.code === 'over_email_send_rate_limit') {
      return { status: 'error', message: 'Too many sign-ups just now. Try again in a little while.' };
    }
    return { status: 'error', message: 'That did not work. Try again in a moment.' };
  }
  return { status: 'sent', email };
}
