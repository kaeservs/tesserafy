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
import { liveAllowedFor, liveScorecard, liveWindow } from '@/lib/live-input';
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

/** How recently a detection must have charged live time for a suggestion to follow it. */
const SUGGEST_AFTER_CHARGE_MS = 2 * 60_000;

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

  const { scorecard } = body;
  if (!scorecard || !liveScorecard(scorecard)) {
    return NextResponse.json({ error: 'scorecard is required' }, { status: 400 });
  }
  // Bounded and redacted before it reaches a model (lib/live-input).
  const window = liveWindow<SuggestableSegment>(body.window);
  if (!window) {
    return NextResponse.json({ error: 'window must be the last few utterances' }, { status: 400 });
  }
  if (!(await liveAllowedFor(who.db, who.userId))) {
    return NextResponse.json({ error: 'Live is not on your plan.' }, { status: 403 });
  }

  // Before the model, after the body. Suggestions cost more per call than
  // detections and are asked for far less often, so the ceiling is tighter.
  const limit = await allowance(who.db, 'api/suggest');
  if (!limit.allowed) return tooMany('api/suggest', limit.retryAfterSeconds);

  // Suggestions ride on detections, which spend the live minutes: one follows
  // each, so this caller must have had live time charged in the last two
  // minutes. Having minutes left used to be enough, and nothing about asking
  // for suggestions ever reduced them (security review, 2026-10-12). With no
  // recent charge there is no suggestion — the same normal answer as "nothing
  // worth asking", so the caller needs no special case.
  const since = new Date(Date.now() - SUGGEST_AFTER_CHARGE_MS).toISOString();
  const { data: charged } = await who.db
    .from('usage_ledger')
    .select('id')
    .eq('user_id', who.userId)
    .eq('meter', 'live_seconds')
    .is('refunded_at', null)
    .gte('at', since)
    .limit(1);
  if (!charged || charged.length === 0) {
    return NextResponse.json({ suggestion: null, reason: 'Suggestions follow the call as it is scored.' });
  }

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
    return NextResponse.json({ error: failure.said }, { status: 502 });
  }
}
