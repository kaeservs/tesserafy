import { recordFailure } from '@/lib/keep-alive';
import { NextResponse, type NextRequest } from 'next/server';
import { liveAllowedFor } from '@/lib/live-input';
import { PLAN_PAGE } from '@/lib/plan';
import { allowance, tooMany } from '@/lib/rate-limit';
import { refused } from '@/lib/refusal';
import { caller } from '@/lib/supabase/caller';
import { grantToken, isCallId, streamUrl, tokenFor, transcriptionAvailable } from '@/lib/transcription';

/**
 * POST /api/live/transcription-token — what the overlay opens its two
 * transcription streams with (ADR 0022): a Deepgram token that lasts a minute,
 * and the stream address with every setting already chosen here.
 *
 * Only for someone whose plan includes live and has live minutes left, and
 * rate limited: a token opens a stream that costs money for as long as it
 * runs. The live minutes themselves are spent as before, by the utterances.
 *
 * And only for a call: the body names a live call the caller started, which
 * has not ended (lib/transcription, tokenFor). It used to name nothing, so a
 * token was for no call at all — anyone with live minutes could take four a
 * minute and thirty a day, each able to open streams on our Deepgram account
 * with no call attached. The overlay creates the call first, then asks.
 */
export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const who = await caller(request);
  if (!who) return NextResponse.json({ error: 'not signed in' }, { status: 401 });
  if (!transcriptionAvailable()) {
    return NextResponse.json({ error: 'Transcription is not switched on for this deployment yet.' }, { status: 503 });
  }
  if (!(await liveAllowedFor(who.db, who.userId))) {
    return NextResponse.json({ error: 'Live is not on your plan.' }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as { conversationId?: unknown } | null;
  const conversationId = body?.conversationId;
  if (!isCallId(conversationId)) {
    // An overlay before 0.1.29 asks before the call exists, and names none.
    return NextResponse.json({ error: 'Update Tesserafy to start a call: this version of the overlay is out of date.' }, { status: 400 });
  }
  // Read as the caller, so a call in another company is no call at all.
  const { data: call, error } = await who.db
    .from('conversations')
    .select('added_by, captured_live, created_at')
    .eq('id', conversationId)
    .maybeSingle();
  if (error) return refused(error, { db: who.db, source: 'api/live/transcription-token' });
  const state = tokenFor(call, who.userId);
  if (state === 'not theirs') return NextResponse.json({ error: 'That is not a live call you started.' }, { status: 404 });
  if (state === 'ended') return NextResponse.json({ error: 'That call has ended: start a new one.' }, { status: 409 });

  const limit = await allowance(who.db, 'api/live/transcription');
  if (!limit.allowed) return tooMany('api/live/transcription', limit.retryAfterSeconds);
  const { data: live } = await who.db.rpc('plan_has_allowance', { p_meter: 'live_seconds' });
  if (live !== true) {
    return NextResponse.json({ error: 'Your plan has no live minutes left this month.', upgrade: PLAN_PAGE }, { status: 402 });
  }

  try {
    const { token, expiresIn } = await grantToken();
    return NextResponse.json({ token, expiresIn, url: streamUrl() }, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    const failure = recordFailure(error, { db: who.db, source: 'api/live/transcription-token', conversationId });
    return NextResponse.json({ error: failure.said }, { status: 502 });
  }
}
