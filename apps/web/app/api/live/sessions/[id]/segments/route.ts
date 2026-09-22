import { NextResponse, type NextRequest } from 'next/server';
import { caller } from '@/lib/supabase/caller';

/**
 * One utterance, as it is finalised.
 *
 * Written per utterance rather than in a batch at the end, for the same
 * reason the conversation is created up front: what is on the server is what
 * survives. It is also what makes the evidence route possible at all — a
 * quote can only be checked against a segment the database already holds.
 *
 * Off the critical path. The caller fires this alongside detection rather
 * than before it, so the round trip never sits between somebody finishing a
 * sentence and the score moving.
 */
export const runtime = 'nodejs';

interface SegmentBody {
  speaker?: string | null;
  startMs?: number;
  endMs?: number;
  text?: string;
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const who = await caller(request);
  if (!who) {
    return NextResponse.json({ error: 'not signed in' }, { status: 401 });
  }

  let body: SegmentBody;
  try {
    body = (await request.json()) as SegmentBody;
  } catch {
    return NextResponse.json({ error: 'body must be JSON' }, { status: 400 });
  }

  const text = (body.text ?? '').trim();
  if (text.length === 0) {
    return NextResponse.json({ error: 'text is required' }, { status: 400 });
  }

  const { data, error } = await who.db.rpc('append_live_segment', {
    p_conversation_id: id,
    p_speaker: body.speaker ?? null,
    p_start_ms: Math.max(0, Math.round(body.startMs ?? 0)),
    p_end_ms: Math.max(0, Math.round(body.endMs ?? body.startMs ?? 0)),
    p_text: text,
  });

  if (error) {
    const status = error.code === '42501' ? 403 : error.code === 'P0002' ? 404 : 502;
    return NextResponse.json({ error: error.message }, { status });
  }

  return NextResponse.json({ segmentId: data as string });
}
