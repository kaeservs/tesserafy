import { fetchCriteria } from '@tesserafy/db';
import { NextResponse, type NextRequest } from 'next/server';
import { caller } from '@/lib/supabase/caller';

/**
 * The criteria a scorecard is built from.
 *
 * The overlay needs these before it can score anything and has no database
 * client of its own — by design: a desktop app shipping a Supabase connection
 * is a desktop app holding a key on someone's laptop. It asks the web app,
 * with the same bearer token it uses for detection.
 *
 * Criteria are reference data rather than tenant data, so any signed-in caller
 * may read them; the table's RLS policy says the same thing.
 */
export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const who = await caller(request);
  if (!who) {
    return NextResponse.json({ error: 'not signed in' }, { status: 401 });
  }

  const engagementType = request.nextUrl.searchParams.get('engagement_type') ?? 'discovery';
  const versionParam = request.nextUrl.searchParams.get('version');

  try {
    const criteria = await fetchCriteria(
      who.db,
      engagementType,
      versionParam ? Number(versionParam) : undefined,
    );
    return NextResponse.json({ criteria });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'could not load criteria' },
      { status: 404 },
    );
  }
}
