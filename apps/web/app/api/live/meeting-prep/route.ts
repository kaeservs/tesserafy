import { NextResponse, type NextRequest } from 'next/server';
import { prepForMeeting } from '@/lib/meeting-prep';
import { caller } from '@/lib/supabase/caller';

/**
 * POST /api/live/meeting-prep — the overlay's "Prepare" on the meeting about
 * to start: a call prep made from it (or the one already made), as the
 * person. No brief: writing one spends the plan's allowance, and is a press
 * on the prep's page.
 */
export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const who = await caller(request);
  if (!who) return NextResponse.json({ error: 'not signed in' }, { status: 401 });
  const body = (await request.json().catch(() => null)) as { eventId?: unknown } | null;
  const eventId = typeof body?.eventId === 'string' && /^[0-9a-f-]{36}$/i.test(body.eventId) ? body.eventId : null;
  if (!eventId) return NextResponse.json({ error: 'which meeting?' }, { status: 400 });
  const prepId = await prepForMeeting(who.db, eventId);
  if (!prepId) return NextResponse.json({ error: 'That meeting could not be prepared.' }, { status: 404 });
  return NextResponse.json({ prepId });
}
