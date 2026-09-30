import { NextResponse, type NextRequest } from 'next/server';
import { liveAllowedFor } from '@/lib/live-input';
import { liveSetup } from '@/lib/live-setup';
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
  const setup = await liveSetup(who.db, who.userId);
  return NextResponse.json({ ...setup, live: await liveAllowedFor(who.db, who.userId) });
}
