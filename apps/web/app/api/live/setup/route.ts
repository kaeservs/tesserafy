import { NextResponse, type NextRequest } from 'next/server';
import { liveAllowedFor } from '@/lib/live-input';
import { syncCalendars } from '@/lib/calendar-sync';
import { liveSetup } from '@/lib/live-setup';
import { overlayClient } from '@/lib/overlay-client';
import { caller } from '@/lib/supabase/caller';

/**
 * GET /api/live/setup — what the overlay starts a call with: the customer,
 * scorecard and prep chosen in the dashboard, and how the overlay looks
 * (lib/live-setup). Read on sign-in and before each call; nothing here is
 * chosen on the overlay.
 */
export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const who = await caller(request);
  if (!who) return NextResponse.json({ error: 'not signed in' }, { status: 401 });
  // Which overlay this is, for the console's "who needs to update". Recorded
  // beside the setup, never instead of it: a failure here must not stop a call.
  const client = overlayClient(request.headers.get('x-tesserafy-overlay'));
  // The calendar, if it has not been read in a quarter of an hour, so the
  // overlay knows the meeting about to start (lib/calendar-sync).
  await syncCalendars(who.db, who.userId);
  const [setup, live] = await Promise.all([
    liveSetup(who.db, who.userId),
    liveAllowedFor(who.db, who.userId),
    client ? who.db.rpc('record_overlay_seen', { p_version: client.version, p_platform: client.platform }) : null,
  ]);
  return NextResponse.json({ ...setup, live });
}
