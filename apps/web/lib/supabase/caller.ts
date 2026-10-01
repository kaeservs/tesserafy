import { createClient as createTokenClient } from '@supabase/supabase-js';
import type { Database, SupabaseClient } from '@tesserafy/db';
import type { NextRequest } from 'next/server';
import { publicSupabaseEnv } from '../env';
import { supportSessionEnded } from '../support-session';
import { createClient } from './server';

/**
 * Who is calling an API route, and a client that is actually them.
 *
 * One path for every route, because three routes had grown two different
 * answers to the same question: /api/detect and /api/criteria accepted a
 * bearer token, the ticket route did not, and nothing said why. A caller
 * holding a valid session got 401 from one endpoint and 200 from another.
 *
 * The token must reach the query, not only the check. Verifying a bearer token
 * and then reading with the cookie client runs the query as nobody, and RLS
 * answers "not found" — which reads like missing data rather than a missing
 * session.
 */
export interface Caller {
  db: SupabaseClient;
  userId: string;
  /**
   * Their access token, for a call made as them beyond the database — the
   * embedding function inside Supabase, which takes a signed-in user's token
   * and nothing weaker.
   */
  token: () => Promise<string | null>;
}

export async function caller(request: NextRequest): Promise<Caller | null> {
  const header = request.headers.get('authorization');

  if (header?.startsWith('Bearer ')) {
    const { url, publishableKey } = publicSupabaseEnv();
    const db = createTokenClient<Database>(url, publishableKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: header } },
    });
    const { data } = await db.auth.getUser(header.slice('Bearer '.length));
    const token = header.slice('Bearer '.length);
    // A support session whose window has closed is not let in (lib/support-session).
    if (!data.user || (await supportSessionEnded(db, token))) return null;
    return { db, userId: data.user.id, token: () => Promise.resolve(token) };
  }

  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  // The session's token, read only after getUser has verified it with Auth.
  if (!data.user) return null;
  const token = (await supabase.auth.getSession()).data.session?.access_token ?? null;
  if (await supportSessionEnded(supabase, token)) return null;
  return { db: supabase, userId: data.user.id, token: () => Promise.resolve(token) };
}
