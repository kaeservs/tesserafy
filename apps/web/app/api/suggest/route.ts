import Anthropic from '@anthropic-ai/sdk';
import {
  databaseSink,
  recordFailure,
  suggestNext,
  T2_SUGGESTER,
  type SuggestableSegment,
} from '@tesserafy/ai';
import type { Scorecard } from '@tesserafy/scoring';
import { NextResponse, type NextRequest } from 'next/server';
import { caller } from '@/lib/supabase/caller';
import { allowance, tooMany } from '@/lib/rate-limit';

/**
 * T2: what to ask next.
 *
 * Separate from /api/detect on purpose. Detection is on the critical path and
 * budgeted in ADR 0010; this is not, and must never delay a score — a
 * suggestion three seconds late is still useful, a score three seconds late is
 * not. Two endpoints keep that separation honest rather than relying on
 * someone remembering it.
 */
export const runtime = 'nodejs';
export const preferredRegion = 'iad1';

interface SuggestBody {
  scorecard?: Scorecard;
  window?: SuggestableSegment[];
}

export async function POST(request: NextRequest) {
  const who = await caller(request);
  if (!who) {
    return NextResponse.json({ error: 'not signed in' }, { status: 401 });
  }
  if (!process.env['ANTHROPIC_API_KEY']) {
    return NextResponse.json({ error: 'ANTHROPIC_API_KEY is not set' }, { status: 503 });
  }

  let body: SuggestBody;
  try {
    body = (await request.json()) as SuggestBody;
  } catch {
    return NextResponse.json({ error: 'body must be JSON' }, { status: 400 });
  }

  const { scorecard, window } = body;
  if (!scorecard || !Array.isArray(scorecard.criteria)) {
    return NextResponse.json({ error: 'scorecard is required' }, { status: 400 });
  }
  if (!Array.isArray(window) || window.length === 0) {
    return NextResponse.json({ error: 'window must be a non-empty array' }, { status: 400 });
  }

  // Before the model, after the body. Suggestions cost more per call than
  // detections and are asked for far less often, so the ceiling is tighter.
  const limit = await allowance(who.db, 'api/suggest');
  if (!limit.allowed) return tooMany('api/suggest', limit.retryAfterSeconds);

  try {
    const result = await suggestNext(scorecard, window, {
      client: new Anthropic(),
      onUsage: databaseSink({ db: who.db, detector: T2_SUGGESTER }),
    });

    // A refusal is a normal answer, not an error: "nothing worth asking" is
    // the right response most of the time, and a 200 keeps the caller's code
    // free of special cases.
    return NextResponse.json('reason' in result ? { suggestion: null, reason: result.reason } : { suggestion: result });
  } catch (error) {
    // See api/detect: the failure gets a destination that is not the browser.
    const failure = recordFailure(error, { db: who.db, source: 'api/suggest', tier: 't2' });
    return NextResponse.json({ error: failure.message }, { status: 502 });
  }
}
