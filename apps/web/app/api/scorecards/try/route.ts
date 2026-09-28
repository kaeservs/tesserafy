import { recordFailure } from '@tesserafy/ai';
import { NextResponse, type NextRequest } from 'next/server';
import { planExhausted, refund, spend } from '@/lib/plan';
import { allowance, tooMany } from '@/lib/rate-limit';
import { draftProblems, parseDraft } from '@/lib/scorecard-draft';
import { caller } from '@/lib/supabase/caller';
import { tryScorecard } from '@/lib/try-scorecard';

/**
 * "Try on recent calls": a draft scorecard over the company's own recent
 * calls, before it is published. Writes no evidence and no score; see
 * lib/try-scorecard.ts.
 *
 * Owners only, like publishing, since drafting a scorecard is the owner's job
 * and a trial spends the company's allowance. Charged as one imported call
 * and given back when nothing reached the model.
 */
export const runtime = 'nodejs';
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  const who = await caller(request);
  if (!who) return NextResponse.json({ error: 'not signed in' }, { status: 401 });

  if (!process.env['ANTHROPIC_API_KEY']) {
    return NextResponse.json({ error: 'Scoring is not configured on this deployment.' }, { status: 503 });
  }

  const draft = parseDraft(await request.json().catch(() => null));
  if (!draft) return NextResponse.json({ error: 'That is not a scorecard.' }, { status: 400 });

  const { data: memberships } = await who.db
    .from('company_members')
    .select('company_id, role')
    .eq('user_id', who.userId);
  const membership = memberships?.length === 1 ? memberships[0]! : null;
  if (membership?.role !== 'owner') {
    return NextResponse.json({ error: 'Only an owner can try a scorecard.' }, { status: 403 });
  }

  const { data: templates } = await who.db
    .from('criteria_definitions')
    .select('engagement_type')
    .is('company_id', null);
  const problems = draftProblems(
    draft.name,
    draft.criteria,
    [...new Set((templates ?? []).map((row) => row.engagement_type))],
  );
  if (problems.length > 0) return NextResponse.json({ error: problems[0], problems }, { status: 422 });

  const limit = await allowance(who.db, 'api/scorecards/try');
  if (!limit.allowed) return tooMany('api/scorecards/try', limit.retryAfterSeconds);

  const spent = await spend(who.db, 'calls');
  if (!spent.allowed) return planExhausted(spent);

  try {
    const outcome = await tryScorecard(who.db, membership.company_id, draft);
    if (outcome.status === 'no_calls') {
      await refund(who.db, spent);
      return NextResponse.json(
        { error: 'There are no calls to try it on yet. Import one first, or publish and score new calls.' },
        { status: 422 },
      );
    }
    return NextResponse.json(outcome);
  } catch (error) {
    await refund(who.db, spent);
    const failure = recordFailure(error, { db: who.db, source: 'api/scorecards/try', tier: 't1' });
    return NextResponse.json({ error: failure.message }, { status: 502 });
  }
}
