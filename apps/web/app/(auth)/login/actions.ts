'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { createSignInClient } from '@/lib/supabase/sign-in';
import { toEmail } from './identifier';

export interface LoginState {
  status: 'idle' | 'sent' | 'error';
  message?: string;
}

export async function sendMagicLink(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get('email') ?? '').trim();
  if (!email.includes('@')) {
    return { status: 'error', message: 'Enter a valid email address.' };
  }

  const origin = (await headers()).get('origin');
  if (!origin) {
    return { status: 'error', message: 'Could not determine the site origin.' };
  }

  const supabase = await createSignInClient();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      // A page, not the route handler: the session comes back in the URL
      // fragment, which only a browser can read.
      emailRedirectTo: `${origin}/auth/confirm`,
      // Invite-only: accounts are created server-side and attached to a
      // company. A self-registered user would belong to no tenant.
      shouldCreateUser: false,
    },
  });

  // Same response whether or not the address has an account, so the form
  // cannot be used to discover who the customers are.
  if (error && error.status !== 400 && error.status !== 422) {
    return { status: 'error', message: 'Something went wrong sending the link. Try again.' };
  }
  return { status: 'sent' };
}

/**
 * Sign in with a password.
 *
 * Added because a magic link costs a round trip through an inbox, and checking
 * a scorecard should not require reading email.
 *
 * It creates nothing. Supabase refuses an address it has never seen, so this
 * is still invite-only: an account has to exist and be attached to a company
 * before it can see a single row.
 *
 * The server client rather than the browser one, so the password is posted to
 * this process and never sits in client-side state. The session is written to
 * cookies here, which is what makes every later query run as this user under
 * RLS.
 */
export async function signInWithPassword(
  _prev: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const identifier = String(formData.get('identifier') ?? '').trim();
  const password = String(formData.get('password') ?? '');

  if (identifier.length === 0 || password.length === 0) {
    return { status: 'error', message: 'Enter a username and a password.' };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: toEmail(identifier),
    password,
  });

  if (error) {
    // Supabase answers "Invalid login credentials" both for a wrong password
    // and for an address it has never seen, which is the right answer to
    // both: saying which would turn this form into an account directory.
    return { status: 'error', message: 'That username and password did not match.' };
  }

  // Outside the try/catch shape above on purpose: redirect() works by
  // throwing, so anything that caught it would silently keep you on the
  // login page with a valid session.
  redirect('/dashboard');
}
