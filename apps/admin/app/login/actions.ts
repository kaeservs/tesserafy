'use server';

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

export interface LoginState {
  status: 'idle' | 'error';
}

/**
 * Sign in, then check.
 *
 * Signing in is ordinary Supabase auth against the same user table the product
 * uses: there is no separate operator credential, because a second password
 * store is a second thing to leak. What makes this console different is not
 * how you get a session but what the database will answer once you have one.
 *
 * A non-operator who signs in correctly is signed straight back out. Leaving
 * them holding a valid session on a console they cannot use is an invitation
 * to go looking for the gap.
 */
export async function signIn(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const value = formData.get('email');
  const secret = formData.get('password');
  const email = typeof value === 'string' ? value.trim() : '';
  const password = typeof secret === 'string' ? secret : '';

  if (!email || !password) return { status: 'error' };

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || !data.user) return { status: 'error' };

  const { data: admin } = await supabase
    .from('platform_admins')
    .select('user_id')
    .eq('user_id', data.user.id)
    .maybeSingle();

  if (!admin) {
    // Local scope, and this is not a detail. signOut() defaults to revoking
    // every refresh token the user holds, everywhere — so a customer who
    // mistyped this console's address into the wrong tab would be signed out
    // of the actual product, on every device they own, for the crime of not
    // being an operator. Only the session this request just created goes.
    await supabase.auth.signOut({ scope: 'local' });
    return { status: 'error' };
  }

  // Outside any try/catch: redirect() throws, and catching it would leave an
  // operator staring at a login form while holding a valid session.
  redirect('/');
}
