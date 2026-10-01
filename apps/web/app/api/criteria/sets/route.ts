import { recordFailure } from '@tesserafy/ai';
import { fetchCriteriaSets } from '@tesserafy/db';
import { NextResponse, type NextRequest } from 'next/server';
import { engagementLabel, myCompanyId } from '@/lib/company';
import { caller } from '@/lib/supabase/caller';

/**
 * The scorecards a caller may score a call against: their company's own and
 * Tesserafy's templates, the newest version of each, the company's own first.
 *
 * For the overlay's picker. Names and versions only — the criteria themselves
 * are fetched for the one chosen, from /api/criteria. Scoped to the caller's
 * own company even when an operator asks (ADR 0016).
 */
export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const who = await caller(request);
  if (!who) return NextResponse.json({ error: 'not signed in' }, { status: 401 });

  try {
    const all = await fetchCriteriaSets(who.db, await myCompanyId(who.db, who.userId));
    const sets = all
      .filter((set) => !all.some((other) => other.engagementType === set.engagementType && other.version > set.version))
      .sort((a, b) => Number(b.own) - Number(a.own) || a.engagementType.localeCompare(b.engagementType))
      .map((set) => ({
        engagementType: set.engagementType,
        version: set.version,
        own: set.own,
        label: engagementLabel(set.engagementType),
      }));
    return NextResponse.json({ sets });
  } catch (error) {
    recordFailure(error, { db: who.db, source: 'api/criteria/sets' });
    return NextResponse.json({ error: 'Could not list the scorecards; it has been recorded.' }, { status: 502 });
  }
}
