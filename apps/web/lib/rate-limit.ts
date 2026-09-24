import type { SupabaseClient } from '@tesserafy/db';
import { NextResponse } from 'next/server';

/**
 * What one account may spend.
 *
 * Two endpoints call Anthropic on every request, and a signed-in session could
 * call them in a loop. The bill is ours, and none of the ways that happens
 * require malice — a retry loop in the overlay, a replay script left running
 * overnight, a component that re-renders more than its author expected.
 *
 * Two windows per endpoint, not one. A minute window stops a runaway loop
 * within a minute; a day window is what actually bounds the invoice, because
 * sixty a minute sustained is eighty-six thousand a day. Both are checked in a
 * single database call, because this sits in front of T1, which ADR 0010
 * already has over its latency budget.
 *
 * The limits are here rather than in the database because they are a product
 * decision that changes with a deploy, not data a version is pinned to. The
 * counting is in the database because it is the only place that can count
 * across however many instances the platform decides to run.
 *
 * Measured cost, stated because the endpoint it guards is already over budget:
 * the check itself is ~114 microseconds of database time, and everything else
 * is the round trip. That round trip is long here — these routes pin
 * `preferredRegion = 'iad1'` to sit near the model while the Supabase project
 * is in `ap-southeast-1`, which is most of the Pacific. It is a second such
 * crossing, not a first: `caller()` already makes one to verify the session
 * before any of this runs. Closing that gap is a deployment question, and the
 * answer is not "spend nothing on limiting" — an unbounded bill is worse than
 * a slower detection.
 */

export interface Window {
  readonly seconds: number;
  readonly limit: number;
}

/**
 * Sized against a real meeting, not a guess.
 *
 * A live scorecard detects once per utterance window. An hour-long call with
 * somebody speaking every ten seconds is around 360 calls, so a day of heavy
 * use is a few thousand — 3000 leaves room for a full day of meetings and
 * stops a loop inside an hour. Suggestions are asked for far less often and
 * cost more per call, so they get a tighter ceiling.
 *
 * Both are per account. Somebody who hits them is having a bad day, not
 * necessarily doing anything wrong, which is why the response says when they
 * can try again rather than just refusing.
 */
export const LIMITS: Record<string, readonly Window[]> = {
  'api/detect': [
    { seconds: 60, limit: 60 },
    { seconds: 86_400, limit: 3000 },
  ],
  'api/suggest': [
    { seconds: 60, limit: 20 },
    { seconds: 86_400, limit: 600 },
  ],
  // An upload now scores itself, up to ~500 detector calls (~$0.95) for the
  // longest call taken on. Ten a day bounds one account at about $9.50 a day,
  // which is a busy week of real meetings, not a runaway.
  // Opus, pressed by a person. Short test calls measured at ~$0.008; a real
  // hour-long call is likely $0.10-0.25. Each call can only be read once, so
  // this bounds how many different calls one account reads in a day.
  'api/extract': [
    { seconds: 3_600, limit: 10 },
    { seconds: 86_400, limit: 20 },
  ],
  // Up to five Opus write-ups per press (lib/find-insights.ts). Three presses
  // an hour and ten a day bound one account at fifty write-ups a day, and
  // cited signals are skipped, so repeated presses find less, not the same.
  'api/insights/find': [
    { seconds: 3_600, limit: 3 },
    { seconds: 86_400, limit: 10 },
  ],
  'api/transcripts': [
    { seconds: 3_600, limit: 6 },
    { seconds: 86_400, limit: 10 },
  ],
};

export interface Allowance {
  readonly allowed: boolean;
  readonly retryAfterSeconds: number;
}

interface TokenResult {
  allowed?: boolean;
  retry_after_seconds?: number;
}

/**
 * Closed on failure, and that is the deliberate half.
 *
 * If the counter cannot be read there are two ways to be wrong. Allowing the
 * request risks an unbounded bill for exactly as long as the database is
 * unhappy, which is the failure this exists to prevent. Refusing it costs a
 * retry on an endpoint that needs that same database to record what it spent,
 * so it was already degraded. The asymmetry is money against a retry.
 */
export async function allowance(
  db: SupabaseClient,
  bucket: keyof typeof LIMITS  ,
): Promise<Allowance> {
  const windows = LIMITS[bucket];
  if (!windows) return { allowed: true, retryAfterSeconds: 0 };

  const { data, error } = await db.rpc('take_rate_limit_tokens', {
    p_bucket: bucket,
    // Copied into plain objects rather than cast: what crosses the wire is
    // JSON, and `readonly Window[]` is a promise about this file, not about
    // the request body.
    p_windows: windows.map((window) => ({ seconds: window.seconds, limit: window.limit })),
  });

  if (error) {
    console.warn(`rate limit unavailable for ${bucket}: ${error.message}`);
    return { allowed: false, retryAfterSeconds: 5 };
  }

  // `allowed !== false` would be the easy bug here: a call that came back with
  // no answer at all would read as permission. A token we cannot confirm was
  // taken is not a token, so only an explicit yes is a yes.
  const result = (data ?? {}) as TokenResult;
  return {
    allowed: result.allowed === true,
    retryAfterSeconds: Math.max(1, Math.ceil(result.retry_after_seconds ?? 1)),
  };
}

/**
 * The 429 itself.
 *
 * `Retry-After` is not decoration: it is the difference between a client that
 * waits and a client that retries immediately and makes the thing it is
 * hitting worse. The caller is told which of their own limits stopped them
 * rather than a bare refusal, because "you are being rate limited" with no
 * number is indistinguishable from the product being broken.
 */
export function tooMany(bucket: string, retryAfterSeconds: number): NextResponse {
  const windows = LIMITS[bucket] ?? [];
  const described = windows
    .map((window) =>
      window.seconds === 86_400
        ? `${window.limit} a day`
        : window.seconds === 3_600
          ? `${window.limit} an hour`
          : `${window.limit} every ${window.seconds}s`,
    )
    .join(', ');

  return NextResponse.json(
    {
      error: `Too many requests. This account is limited to ${described}. Try again in ${retryAfterSeconds}s.`,
      retryAfterSeconds,
    },
    { status: 429, headers: { 'retry-after': String(retryAfterSeconds) } },
  );
}
