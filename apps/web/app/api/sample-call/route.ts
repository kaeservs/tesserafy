import { redactSegments, toSegments } from '@tesserafy/ingest';
import { recordFailure } from '@tesserafy/ai';
import { after, NextResponse, type NextRequest } from 'next/server';
import { allowance, tooMany } from '@/lib/rate-limit';
import { embedUploadedConversation } from '@/lib/embed-upload';
import { SAMPLE_TITLE, sampleTurns } from '@/lib/sample-call';
import { scoreUploadedConversation } from '@/lib/score-upload';
import { caller } from '@/lib/supabase/caller';

/**
 * POST /api/sample-call — import Tesserafy's sample call and score it, so a
 * company with nothing yet sees what a scored call looks like.
 *
 * The same path as an upload — rate limit, redaction, the import function,
 * scoring, embedding — with two differences, both deliberate. It sends only
 * the sample's own words, never anything from the request; and it does not
 * spend the plan's allowance, because a trial has three imported calls and a
 * demonstration should not cost one. import_sample_call allows one per
 * company, ever, so that exception stays one short scoring pass.
 *
 * Scored before answering, so the page it opens already has a scorecard.
 */
export const runtime = 'nodejs';

export const maxDuration = 120;

export async function POST(request: NextRequest) {
  const who = await caller(request);
  if (!who) {
    return NextResponse.json({ error: 'not signed in' }, { status: 401 });
  }
  const limit = await allowance(who.db, 'api/transcripts');
  if (!limit.allowed) return tooMany('api/transcripts', limit.retryAfterSeconds);

  const { segments } = redactSegments(toSegments(sampleTurns()));
  const { data: conversationId, error } = await who.db.rpc('import_sample_call', {
    p_title: SAMPLE_TITLE,
    p_segments: segments.map((segment) => ({
      speaker: segment.speaker,
      startMs: segment.startMs,
      endMs: segment.endMs,
      text: segment.text,
    })),
  });
  if (error) {
    if (error.code === '23505') {
      return NextResponse.json({ error: 'Your company has already had the sample call.' }, { status: 409 });
    }
    if (error.code === '42501') return NextResponse.json({ error: 'not a member of a company' }, { status: 403 });
    recordFailure(error, { db: who.db, source: 'api/sample-call' });
    return NextResponse.json({ error: 'The sample call could not be imported.' }, { status: 502 });
  }

  let scoring = 'skipped';
  if (process.env['ANTHROPIC_API_KEY']) {
    try {
      scoring = (await scoreUploadedConversation(who.db, conversationId)).status;
    } catch (cause) {
      recordFailure(cause, { db: who.db, source: 'api/sample-call/score', tier: 't1', conversationId });
      scoring = 'failed';
    }
  }

  const accessToken =
    request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ??
    (await who.db.auth.getSession()).data.session?.access_token ??
    null;
  after(async () => {
    if (!accessToken) return;
    await embedUploadedConversation(who.db, conversationId, accessToken).catch((cause: unknown) => {
      recordFailure(cause, { db: who.db, source: 'api/sample-call/embed', conversationId });
    });
  });

  return NextResponse.json({ conversationId, scoring });
}
