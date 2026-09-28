import { NextResponse, type NextRequest } from 'next/server';
import { csvFilename, csvResponse, toCsv } from '@/lib/csv';
import { filterAndSort } from '@/lib/meeting-filters';
import { findMeetings } from '@/lib/meetings';
import { allowance, tooMany } from '@/lib/rate-limit';
import { caller } from '@/lib/supabase/caller';

/**
 * The Meetings list as CSV: every call the same filters match, not one page.
 *
 * Titles, dates, scorecards, outcomes and scores — what the list shows, and
 * no transcript. The seller column follows the list's rule: owners get it,
 * members do not. Scores are computed now, from the evidence, as the page
 * computes them.
 */
export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const who = await caller(request);
  if (!who) return NextResponse.json({ error: 'not signed in' }, { status: 401 });

  const limit = await allowance(who.db, 'api/export/csv');
  if (!limit.allowed) return tooMany('api/export/csv', limit.retryAfterSeconds);

  const [{ data: membership }, { data: team }, { data: company }, { data: accountRows }] = await Promise.all([
    who.db.from('company_members').select('role').eq('user_id', who.userId).limit(1).maybeSingle(),
    who.db.rpc('company_team'),
    who.db.from('companies').select('name').limit(1).maybeSingle(),
    who.db.from('accounts').select('id, name'),
  ]);
  const accountOf = new Map((accountRows ?? []).map((row) => [row.id, row.name]));
  const isOwner = membership?.role === 'owner';
  const params = Object.fromEntries(request.nextUrl.searchParams.entries());
  const { filters, meetings } = await findMeetings(who.db, params, { userId: who.userId, isOwner });
  const rows = filterAndSort(meetings, filters);

  const emailOf = new Map((team ?? []).map((person) => [person.user_id, person.email]));
  const origin = request.nextUrl.origin;
  const header = [
    'date',
    'title',
    'customer',
    'scorecard',
    'scorecard_version',
    'outcome',
    'score',
    'criteria_met',
    'criteria_total',
    ...(isOwner ? ['seller'] : []),
    'link',
  ];
  const body = toCsv(
    header,
    rows.map((meeting) => {
      const criteria = meeting.card?.scorecard.criteria ?? [];
      return [
        (meeting.occurred_at ?? meeting.created_at).slice(0, 10),
        meeting.title,
        meeting.account_id ? (accountOf.get(meeting.account_id) ?? null) : null,
        meeting.engagement_type,
        meeting.criteria_version,
        meeting.outcome,
        meeting.score === null ? null : Math.round(meeting.score),
        criteria.filter((criterion) => criterion.status === 'confirmed').length,
        criteria.length,
        ...(isOwner ? [meeting.added_by ? (emailOf.get(meeting.added_by) ?? 'a former member') : null] : []),
        `${origin}/conversations/${meeting.id}`,
      ];
    }),
  );
  return csvResponse(body, csvFilename(company?.name ?? 'company', 'meetings'));
}
