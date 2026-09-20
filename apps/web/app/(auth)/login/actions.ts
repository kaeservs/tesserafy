'use server';

import { headers } from 'next/headers';
import { createSignInClient } from '@/lib/supabase/sign-in';

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
