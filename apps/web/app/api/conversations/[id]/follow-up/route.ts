import { recordFailure } from '@tesserafy/ai';
import { NextResponse, type NextRequest } from 'next/server';
import { draftCallFollowUp } from '@/lib/follow-up';
import { planExhausted, refund, spend } from '@/lib/plan';
import { allowance, tooMany } from '@/lib/rate-limit';
import { caller } from '@/lib/supabase/caller';

/**
 * POST /api/conversations/:id/follow-up — draft the call's follow-up email.
 *
 * One read of the call by the larger model, like its action items, so the
 * same allowance and rate limit; given back when nothing was drafted. The
 * overlay opens the call's page for it when a call ends; the draft is made
 * here, as the seller, never on its own.
 */
export const runtime = 'nodejs';
export const maxDuration = 300;

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const who = await caller(request);
  if (!who) return NextResponse.json({ error: 'not signed in' }, { status: 401 });
  if (!process.env['ANTHROPIC_API_KEY']) {
    return NextResponse.json({ error: 'Follow-ups are not configured on this deployment.' }, { status: 503 });
  }
  const limit = await allowance(who.db, 'api/extract');
  if (!limit.allowed) return tooMany('api/extract', limit.retryAfterSeconds);
  const spent = await spend(who.db, 'extractions');
  if (!spent.allowed) return planExhausted(spent);

  const { id } = await params;
  try {
    const outcome = await draftCallFollowUp(who.db, id);
    if (outcome.status !== 'drafted') {
      await refund(who.db, spent);
      return NextResponse.json(
        { error: outcome.status === 'not_found' ? 'That call was not found.' : 'This call has no transcript to read.' },
        { status: outcome.status === 'not_found' ? 404 : 422 },
      );
    }
    return NextResponse.json({ lines: outcome.lines, dropped: outcome.dropped });
  } catch (error) {
    await refund(who.db, spent);
    const failure = recordFailure(error, { db: who.db, source: 'api/conversations/follow-up', tier: 't3', conversationId: id });
    return NextResponse.json({ error: failure.message }, { status: 502 });
  }
}
