import { recordFailure } from '@tesserafy/ai';
import { NextResponse, type NextRequest } from 'next/server';
import { findInsights, NoSingleCompany } from '@/lib/find-insights';
import { allowance, tooMany } from '@/lib/rate-limit';
import { caller } from '@/lib/supabase/caller';

/**
 * "Look for patterns across your calls."
 *
 * Synchronous, like extraction: a person asked and is waiting, so the answer —
 * how many were proposed, how many Opus declined — comes back in the response.
 * See lib/find-insights.ts for why it runs as the customer and what stops it
 * proposing the same finding twice.
 */
export const runtime = 'nodejs';
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  const who = await caller(request);
  if (!who) return NextResponse.json({ error: 'not signed in' }, { status: 401 });

  if (!process.env['ANTHROPIC_API_KEY']) {
    return NextResponse.json({ error: 'Insights are not configured on this deployment.' }, { status: 503 });
  }

  const limit = await allowance(who.db, 'api/insights/find');
  if (!limit.allowed) return tooMany('api/insights/find', limit.retryAfterSeconds);

  const accessToken =
    request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ??
    (await who.db.auth.getSession()).data.session?.access_token ??
    null;
  if (!accessToken) return NextResponse.json({ error: 'not signed in' }, { status: 401 });

  try {
    return NextResponse.json(await findInsights(who.db, who.userId, accessToken));
  } catch (error) {
    if (error instanceof NoSingleCompany) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    const failure = recordFailure(error, { db: who.db, source: 'api/insights/find', tier: 't3' });
    return NextResponse.json({ error: failure.message }, { status: 502 });
  }
}
