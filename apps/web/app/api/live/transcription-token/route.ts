import { recordFailure } from '@tesserafy/ai';
import { NextResponse, type NextRequest } from 'next/server';
import { liveAllowedFor } from '@/lib/live-input';
import { allowance, tooMany } from '@/lib/rate-limit';
import { caller } from '@/lib/supabase/caller';
import { grantToken, streamUrl, transcriptionAvailable } from '@/lib/transcription';

/**
 * POST /api/live/transcription-token — what the overlay opens its two
 * transcription streams with (ADR 0022): a Deepgram token that lasts a minute,
 * and the stream address with every setting already chosen here.
 *
 * Only for someone whose plan includes live and has live minutes left, and
 * rate limited: a token opens a stream that costs money for as long as it
 * runs. The live minutes themselves are spent as before, by the utterances.
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
  const limit = await allowance(who.db, 'api/live/transcription');
  if (!limit.allowed) return tooMany('api/live/transcription', limit.retryAfterSeconds);
  const { data: live } = await who.db.rpc('plan_has_allowance', { p_meter: 'live_seconds' });
  if (live !== true) return NextResponse.json({ error: 'Your plan has no live minutes left this month.' }, { status: 402 });

  try {
    const { token, expiresIn } = await grantToken();
    return NextResponse.json({ token, expiresIn, url: streamUrl() }, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    const failure = recordFailure(error, { db: who.db, source: 'api/live/transcription-token' });
    return NextResponse.json({ error: failure.said }, { status: 502 });
  }
}
