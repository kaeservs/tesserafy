import { recordFailure } from '@tesserafy/ai';
import { NextResponse, type NextRequest } from 'next/server';
import { planExhausted, refund, spend } from '@/lib/plan';
import { writePrepBrief } from '@/lib/prep';
import { allowance, tooMany } from '@/lib/rate-limit';
import { caller } from '@/lib/supabase/caller';

/**
 * POST /api/preps/:id/brief — write (or rewrite) the brief for a call prep.
 *
 * Asked for by a person and waited on, like "Find insights in this call", and
 * charged to the same allowance: one read by the larger model. Given back
 * when nothing was written.
 */
export const runtime = 'nodejs';
export const maxDuration = 120;

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const who = await caller(request);
  if (!who) return NextResponse.json({ error: 'not signed in' }, { status: 401 });
  if (!process.env['ANTHROPIC_API_KEY']) {
    return NextResponse.json({ error: 'Call prep is not configured on this deployment.' }, { status: 503 });
  }

  const limit = await allowance(who.db, 'api/preps');
  if (!limit.allowed) return tooMany('api/preps', limit.retryAfterSeconds);
  const spent = await spend(who.db, 'extractions');
  if (!spent.allowed) return planExhausted(spent);

  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as { research?: unknown };
  try {
    const outcome = await writePrepBrief(who.db, id, undefined, body.research === true);
    if (outcome.status === 'not_found') {
      await refund(who.db, spent);
      return NextResponse.json({ error: 'That prep was not found.' }, { status: 404 });
    }
    // Research that failed is said, not hidden: the brief was written from what there was.
    return NextResponse.json({ brief: outcome.brief, researchErrors: outcome.researchErrors });
  } catch (error) {
    await refund(who.db, spent);
    // A refusal to store is someone who may read the prep but not change it.
    if (error instanceof Error && /only whoever wrote it/.test(error.message)) {
      return NextResponse.json({ error: 'Only whoever wrote this prep, or an owner, can rewrite its brief.' }, { status: 403 });
    }
    const failure = recordFailure(error, { db: who.db, source: 'api/preps/brief', tier: 't3' });
    return NextResponse.json({ error: failure.message }, { status: 502 });
  }
}
