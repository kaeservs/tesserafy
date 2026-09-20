import { fetchCriteria } from '@tesserafy/db';
import { createClient as createTokenClient, type SupabaseClient } from '@supabase/supabase-js';
import { NextResponse, type NextRequest } from 'next/server';
import { publicSupabaseEnv } from '@/lib/env';
import { createClient } from '@/lib/supabase/server';

/**
 * The criteria a scorecard is built from.
 *
 * The overlay needs these before it can score anything and has no database
 * client of its own — by design: a desktop app shipping a Supabase connection
 * is a desktop app holding a key on someone's laptop. It asks the web app,
 * with the same bearer token it uses for detection.
 *
 * Criteria are reference data rather than tenant data, so any signed-in caller
 * may read them; the table's RLS policy says the same thing.
 */
export const runtime = 'nodejs';

/**
 * A client that is actually the caller.
 *
 * The token has to reach the query, not only the check. Verifying a bearer
 * token and then reading with the cookie client would run the query as nobody,
 * and RLS would answer "no criteria" — which reads like missing data rather
 * than a missing session, and would have sent the next person hunting through
 * the seed instead of the header.
 */
async function callerClient(request: NextRequest): Promise<SupabaseClient | null> {
  const header = request.headers.get('authorization');

  if (header?.startsWith('Bearer ')) {
    const { url, publishableKey } = publicSupabaseEnv();
    const client = createTokenClient(url, publishableKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: header } },
    });
    const { data } = await client.auth.getUser(header.slice('Bearer '.length));
    return data.user ? client : null;
  }

  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  return data.user ? (supabase as unknown as SupabaseClient) : null;
}

export async function GET(request: NextRequest) {
  const db = await callerClient(request);
  if (!db) {
    return NextResponse.json({ error: 'not signed in' }, { status: 401 });
  }

  const engagementType = request.nextUrl.searchParams.get('engagement_type') ?? 'discovery';
  const versionParam = request.nextUrl.searchParams.get('version');

  try {
    const criteria = await fetchCriteria(
      db,
      engagementType,
      versionParam ? Number(versionParam) : undefined,
    );
    return NextResponse.json({ criteria });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'could not load criteria' },
      { status: 404 },
    );
  }
}
