import Anthropic from '@anthropic-ai/sdk';
import { databaseSink, suggestNext, type SuggestableSegment } from '@tesserafy/ai';
import type { Scorecard } from '@tesserafy/scoring';
import { NextResponse, type NextRequest } from 'next/server';
import { caller } from '@/lib/supabase/caller';

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

  try {
    const result = await suggestNext(scorecard, window, {
      client: new Anthropic(),
      onUsage: databaseSink({ db: who.db }),
    });

    // A refusal is a normal answer, not an error: "nothing worth asking" is
    // the right response most of the time, and a 200 keeps the caller's code
    // free of special cases.
    return NextResponse.json('reason' in result ? { suggestion: null, reason: result.reason } : { suggestion: result });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'suggestion failed' },
      { status: 502 },
    );
  }
}
