import { recordFailure } from '@tesserafy/ai';
import { NextResponse, type NextRequest } from 'next/server';
import { findActionItems } from '@/lib/action-items';
import { planExhausted, refund, spend } from '@/lib/plan';
import { allowance, tooMany } from '@/lib/rate-limit';
import { caller } from '@/lib/supabase/caller';

/**
 * POST /api/conversations/:id/actions — find the call's action items.
 *
 * Asked for and waited on, like "Find insights in this call", and charged to
 * the same allowance and the same rate limit: one read of the call by the
 * larger model. Given back when nothing was read.
 */
export const runtime = 'nodejs';
export const maxDuration = 300;

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const who = await caller(request);
  if (!who) return NextResponse.json({ error: 'not signed in' }, { status: 401 });
  if (!process.env['ANTHROPIC_API_KEY']) {
    return NextResponse.json({ error: 'Action items are not configured on this deployment.' }, { status: 503 });
  }
  const limit = await allowance(who.db, 'api/extract');
  if (!limit.allowed) return tooMany('api/extract', limit.retryAfterSeconds);
  const spent = await spend(who.db, 'extractions');
  if (!spent.allowed) return planExhausted(spent);

  const { id } = await params;
  try {
    const outcome = await findActionItems(who.db, id);
    if (outcome.status !== 'found') {
      await refund(who.db, spent);
      return NextResponse.json(
        { error: outcome.status === 'not_found' ? 'That call was not found.' : 'This call has no transcript to read.' },
        { status: outcome.status === 'not_found' ? 404 : 422 },
      );
    }
    return NextResponse.json({ recorded: outcome.recorded, rejected: outcome.rejected });
  } catch (error) {
    await refund(who.db, spent);
    const failure = recordFailure(error, { db: who.db, source: 'api/conversations/actions', tier: 't3', conversationId: id });
    return NextResponse.json({ error: failure.message }, { status: 502 });
  }
}
