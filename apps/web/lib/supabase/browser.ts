import { createBrowserClient } from '@supabase/ssr';
import { publicSupabaseEnv } from '../env';

/**
 * A client in the page, which writes the session to cookies the server can
 * read. Used only to complete a sign-in: every other query in this app runs
 * on the server, where RLS applies to a session the browser cannot forge.
 */
export function createClient() {
  const { url, publishableKey } = publicSupabaseEnv();
  return createBrowserClient(url, publishableKey);
}
