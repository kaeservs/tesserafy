import { NextResponse, type NextRequest } from 'next/server';
import { RECORDING_AGREEMENT } from '@/lib/consent';
import { TERMS_VERSION } from '@/lib/legal';
import { refused } from '@/lib/refusal';
import { caller } from '@/lib/supabase/caller';

/**
 * POST /api/live/agreement — the one-time recording agreement (ADR 0020).
 *
 * Made once, by the person, from the overlay or the web: to tell everyone on
 * every call they record, and that doing so is their responsibility. The words
 * and the Terms version are the server's, not the caller's, so what is on
 * record is exactly what was shown. Agreeing again to the same version keeps
 * the first agreement.
 */
export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const who = await caller(request);
  if (!who) return NextResponse.json({ error: 'not signed in' }, { status: 401 });
  const body = (await request.json().catch(() => ({}))) as { surface?: unknown };
  const surface = body.surface === 'web' ? 'web' : 'overlay';
  const { data, error } = await who.db.rpc('agree_to_recording', {
    p_terms_version: TERMS_VERSION,
    p_statement: RECORDING_AGREEMENT,
    p_surface: surface,
  });
  if (error) return refused(error, { db: who.db, source: 'api/live/agreement' });
  return NextResponse.json({ agreedAt: data, termsVersion: TERMS_VERSION });
}
