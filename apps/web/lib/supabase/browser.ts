import { createBrowserClient } from '@supabase/ssr';
import { createClient as createUnstoredClient, type Session } from '@supabase/supabase-js';
import { publicSupabaseEnv } from '../env';
import { SESSION_COOKIE } from './cookies';

/**
 * A client in the page, which writes the session to cookies the server can
 * read. Used only to complete a sign-in: every other query in this app runs
 * on the server, where RLS applies to a session the browser cannot forge.
 */
export function createClient() {
  const { url, publishableKey } = publicSupabaseEnv();
  return createBrowserClient(url, publishableKey, { cookieOptions: SESSION_COOKIE });
}

/**
 * The session a sign-in link opens, learned from Auth and written nowhere.
 *
 * A link's fragment carries an access token and a refresh token, and neither
 * says by itself whose it is: anyone can write an access token's claims, and
 * setSession takes an expired one's refresh token on trust and signs in as
 * whoever that belongs to. So the refresh token is spent here, on a client
 * that keeps nothing, for a session Auth issues with its own account. That is
 * the account /auth/confirm names and asks about, and the session it writes.
 */
export async function sessionFromLink(refreshToken: string): Promise<{ session: Session } | { error: string }> {
  const { url, publishableKey } = publicSupabaseEnv();
  const unstored = createUnstoredClient(url, publishableKey, {
    // A key of its own, so it is never taken for the signed-in client.
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: 'sb-sign-in-link' },
  });
  const { data, error } = await unstored.auth.refreshSession({ refresh_token: refreshToken });
  return data.session ? { session: data.session } : { error: error?.code ?? 'session_failed' };
}
