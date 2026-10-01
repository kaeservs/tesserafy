import { recordFailure } from '@tesserafy/ai';
import { fetchCriteria } from '@tesserafy/db';
import { NextResponse, type NextRequest } from 'next/server';
import { myCompanyId } from '@/lib/company';
import { caller } from '@/lib/supabase/caller';

/**
 * The criteria a scorecard is built from.
 *
 * The overlay needs these before it can score anything and has no database
 * client of its own — by design: a desktop app shipping a Supabase connection
 * is a desktop app holding a key on someone's laptop. It asks the web app,
 * with the same bearer token it uses for detection.
 *
 * Any signed-in caller may read the templates and their own company's sets
 * (ADR 0016) — never another company's, even when an operator is asking.
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
      await myCompanyId(who.db, who.userId),
      engagementType,
      versionParam ? Number(versionParam) : undefined,
    );
    return NextResponse.json({ criteria });
  } catch (error) {
    // A scorecard that does not exist is an answer; anything else is the
    // database's own words, which are recorded rather than handed back.
    if (error instanceof Error && error.message.startsWith('No criteria for ')) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    recordFailure(error, { db: who.db, source: 'api/criteria' });
    return NextResponse.json({ error: 'Could not load the scorecard; it has been recorded.' }, { status: 502 });
  }
}
