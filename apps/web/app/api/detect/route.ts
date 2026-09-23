import Anthropic from '@anthropic-ai/sdk';
import {
  databaseSink,
  detectCriteria,
  recordFailure,
  T1_DETECTOR,
  type CriterionPrompt,
  type DetectableSegment,
} from '@tesserafy/ai';
import { NextResponse, type NextRequest } from 'next/server';
import { caller } from '@/lib/supabase/caller';
import { allowance, tooMany } from '@/lib/rate-limit';

/**
 * T1 criterion detection, run server-side.
 *
 * Spike S3 measured the two obvious places to run T1 and both missed the
 * 700 ms budget: from a client the round trip alone costs ~750 ms, and a local
 * 4B model took ~54 s per window. Running it beside the model is the only
 * remaining candidate, and this endpoint exists to measure it rather than
 * assume it — `usage.durationMs` is what the model took, and the caller's own
 * clock gives the round trip, so the difference is the network cost this
 * topology is supposed to remove.
 *
 * It holds an Anthropic key and no database credentials. There is deliberately
 * no service-role client here: the retrieval guard fails CI if one appears
 * under apps/web, and detection needs no tenant data — the window is supplied
 * by the caller, who had to be signed in to get this far.
 */
export const runtime = 'nodejs';

/** Near the model, which is the entire point of this endpoint. */
export const preferredRegion = 'iad1';

interface DetectBody {
  criteria?: CriterionPrompt[];
  window?: DetectableSegment[];
  variant?: 'full' | 'compact';
}

export async function POST(request: NextRequest) {
  // Detection needs no tenant data — the window comes from the caller — so
  // this only needs to know that somebody signed in is asking. The client is
  // kept to record what the call cost.
  const who = await caller(request);
  if (!who) {
    return NextResponse.json({ error: 'not signed in' }, { status: 401 });
  }

  if (!process.env['ANTHROPIC_API_KEY']) {
    return NextResponse.json({ error: 'ANTHROPIC_API_KEY is not set' }, { status: 503 });
  }

  let body: DetectBody;
  try {
    body = (await request.json()) as DetectBody;
  } catch {
    return NextResponse.json({ error: 'body must be JSON' }, { status: 400 });
  }

  const { criteria, window, variant } = body;
  if (!Array.isArray(criteria) || criteria.length === 0) {
    return NextResponse.json({ error: 'criteria must be a non-empty array' }, { status: 400 });
  }
  if (!Array.isArray(window) || window.length === 0) {
    return NextResponse.json({ error: 'window must be a non-empty array' }, { status: 400 });
  }

  const receivedAt = Date.now();

  // After validation and before the model: a malformed request costs us
  // nothing at Anthropic, so it is not worth a database round trip to refuse.
  //
  // Inside the serverMs measurement on purpose. This endpoint's whole reason
  // for existing is to report what it costs beyond the model, and a limiter
  // measured outside that number would be a limiter whose cost this product
  // could not see.
  const limit = await allowance(who.db, 'api/detect');
  if (!limit.allowed) return tooMany('api/detect', limit.retryAfterSeconds);

  try {
    const result = await detectCriteria(window, {
      client: new Anthropic(),
      criteria,
      ...(variant ? { variant } : {}),
      // Recorded as the caller, so a T1 call lands in the same table as the
      // batch ones. No company: a detection knows a window, not a tenant.
      // Recording never blocks the response — the sink swallows its own
      // failures, because a scorecard that stalls on telemetry is worse than
      // a missing row.
      onUsage: databaseSink({
        db: who.db,
        // The prompt version, variant included. Without it a change in cost
        // cannot be attributed to the change that caused it.
        detector: variant === 'compact' ? `${T1_DETECTOR}-compact` : T1_DETECTOR,
      }),
    });

    return NextResponse.json({
      events: result.events,
      rejected: result.rejected,
      detector: result.detector,
      model: result.model,
      usage: result.usage,
      // Everything this endpoint spent that was not the model: parsing,
      // auth and its own overhead. The caller subtracts its round trip from
      // this to see what the network actually costs.
      serverMs: Date.now() - receivedAt,
    });
  } catch (error) {
    // Recorded before it is answered. The browser still gets the message, but
    // it is no longer the only thing that does: a request this endpoint built
    // wrong used to be visible only to whoever happened to have the console
    // open, which is how three tiers stayed broken for four merges.
    //
    // The scrubbed message goes back to the caller too. An upstream error
    // quotes the request, and the request is a customer's words.
    const failure = recordFailure(error, { db: who.db, source: 'api/detect', tier: 't1' });
    return NextResponse.json({ error: failure.message }, { status: 502 });
  }
}
