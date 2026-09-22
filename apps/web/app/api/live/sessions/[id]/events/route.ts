import { NextResponse, type NextRequest } from 'next/server';
import { caller } from '@/lib/supabase/caller';

/**
 * The evidence behind a live score, kept.
 *
 * Everything in the request is a claim about a segment the database already
 * holds, and record_criterion_events() checks it: the quote's offsets are
 * derived from the stored text rather than taken from here, the criterion
 * must belong to the set the conversation pins, and the segment must belong
 * to the conversation. A claim that fails any of those is counted as rejected
 * rather than stored.
 *
 * So this route deliberately does almost nothing. Validation that matters
 * lives beside the data it validates against; a check in TypeScript here
 * would be a check a determined caller skips by talking to PostgREST.
 *
 * No score is sent and none could be: the events are spans and confidences,
 * and the number is computed on read by packages/scoring (invariant 1).
 */
export const runtime = 'nodejs';

interface EventBody {
  events?: {
    criterionKey?: string;
    kind?: string;
    confidence?: number;
    segmentId?: string;
    quote?: string;
    detector?: string;
    model?: string;
  }[];
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const who = await caller(request);
  if (!who) {
    return NextResponse.json({ error: 'not signed in' }, { status: 401 });
  }

  let body: EventBody;
  try {
    body = (await request.json()) as EventBody;
  } catch {
    return NextResponse.json({ error: 'body must be JSON' }, { status: 400 });
  }

  const events = body.events ?? [];
  if (!Array.isArray(events)) {
    return NextResponse.json({ error: 'events must be an array' }, { status: 400 });
  }
  if (events.length === 0) {
    // Nothing detected in that window is the common case, not a mistake.
    return NextResponse.json({ recorded: 0, rejected: 0 });
  }

  const { data, error } = await who.db.rpc('record_criterion_events', {
    p_conversation_id: id,
    p_events: events.map((event) => ({
      criterion_key: event.criterionKey,
      kind: event.kind ?? 'evidence',
      confidence: event.confidence,
      segment_id: event.segmentId,
      quote: event.quote,
      detector: event.detector,
      model: event.model,
    })),
  });

  if (error) {
    const status = error.code === '42501' ? 403 : error.code === 'P0002' ? 404 : 502;
    return NextResponse.json({ error: error.message }, { status });
  }

  return NextResponse.json(data as { recorded: number; rejected: number });
}
