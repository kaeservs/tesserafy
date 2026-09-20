import { createClient as createTokenClient, type SupabaseClient } from '@supabase/supabase-js';
import type { NextRequest } from 'next/server';
import { publicSupabaseEnv } from '../env';
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
}

export async function caller(request: NextRequest): Promise<Caller | null> {
  const header = request.headers.get('authorization');

  if (header?.startsWith('Bearer ')) {
    const { url, publishableKey } = publicSupabaseEnv();
    const db = createTokenClient(url, publishableKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: header } },
    });
    const { data } = await db.auth.getUser(header.slice('Bearer '.length));
    return data.user ? { db, userId: data.user.id } : null;
  }

  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  return data.user
    ? { db: supabase as unknown as SupabaseClient, userId: data.user.id }
    : null;
}
