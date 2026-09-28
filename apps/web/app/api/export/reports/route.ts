import { NextResponse, type NextRequest } from 'next/server';
import { criteriaByOutcome } from '@/lib/coaching';
import { loadCoachingCalls } from '@/lib/coaching-data';
import { csvFilename, csvResponse, toCsv } from '@/lib/csv';
import { allowance, tooMany } from '@/lib/rate-limit';
import { buildReport } from '@/lib/report';
import { filterCalls, parseReportFilters } from '@/lib/report-filters';
import { caller } from '@/lib/supabase/caller';

/**
 * Reports as CSV, one table at a time: `?table=weeks`, `sellers` or `wins`.
 *
 * The same numbers as the page, under the same rule: the sellers table is
 * every seller for an owner and only their own row for a member.
 */
export const runtime = 'nodejs';

const TABLES = ['weeks', 'sellers', 'wins'] as const;
type Table = (typeof TABLES)[number];

function round(value: number | null): number | null {
  return value === null ? null : Math.round(value * 10) / 10;
}

export async function GET(request: NextRequest) {
  const who = await caller(request);
  if (!who) return NextResponse.json({ error: 'not signed in' }, { status: 401 });

  const table = request.nextUrl.searchParams.get('table') as Table | null;
  if (!table || !TABLES.includes(table)) {
    return NextResponse.json({ error: 'Ask for table=weeks, sellers or wins.' }, { status: 400 });
  }

  const limit = await allowance(who.db, 'api/export/csv');
  if (!limit.allowed) return tooMany('api/export/csv', limit.retryAfterSeconds);

  const [{ data: membership }, { data: team }, { data: company }, calls] = await Promise.all([
    who.db.from('company_members').select('role').eq('user_id', who.userId).limit(1).maybeSingle(),
    who.db.rpc('company_team'),
    who.db.from('companies').select('name').limit(1).maybeSingle(),
    loadCoachingCalls(who.db),
  ]);
  const isOwner = membership?.role === 'owner';
  const filename = csvFilename(company?.name ?? 'company', table);
  // The page's filters, so a download is what was on screen.
  const filters = parseReportFilters(Object.fromEntries(request.nextUrl.searchParams.entries()), { isOwner });
  const selected = filterCalls(calls, filters, who.userId);

  if (table === 'wins') {
    const rows = criteriaByOutcome(selected).flatMap((comparison) =>
      comparison.criteria.map((criterion) => [
        comparison.engagementType,
        criterion.label,
        Math.round(criterion.wonRate * 100),
        Math.round(criterion.lostRate * 100),
        comparison.won,
        comparison.lost,
      ]),
    );
    return csvResponse(
      toCsv(['scorecard', 'criterion', 'met_on_won_pct', 'met_on_lost_pct', 'won_calls', 'lost_calls'], rows),
      filename,
    );
  }

  const report = buildReport(
    selected.map((call) => ({ date: call.date, addedBy: call.addedBy, score: call.score, criteria: [...call.criteria] })),
    new Date(),
    filters.weeks,
  );

  if (table === 'weeks') {
    return csvResponse(
      toCsv(
        ['week_starting', 'calls', 'scored', 'average_score'],
        report.weeks.map((week) => [week.start, week.calls, week.scored, round(week.average)]),
      ),
      filename,
    );
  }

  const emailOf = new Map((team ?? []).map((person) => [person.user_id, person.email]));
  const sellers = isOwner ? report.sellers : report.sellers.filter((seller) => seller.addedBy === who.userId);
  return csvResponse(
    toCsv(
      ['seller', 'calls', 'scored', 'average_score', 'last_4_weeks', 'previous_4_weeks', 'most_missed', 'most_missed_confirmed_pct'],
      sellers.map((seller) => [
        seller.addedBy === null ? 'unattributed' : (emailOf.get(seller.addedBy) ?? 'a former member'),
        seller.calls,
        seller.scored,
        round(seller.average),
        round(seller.recent),
        round(seller.previous),
        seller.mostMissed?.label ?? null,
        seller.mostMissed ? Math.round(seller.mostMissed.confirmedRate * 100) : null,
      ]),
    ),
    filename,
  );
}
