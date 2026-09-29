import { readAll, type SupabaseClient } from '@tesserafy/db';
import { asOutcome, type CoachingCall } from './coaching';
import { scoreConversations } from './scorecard';

interface Row {
  id: string;
  company_id: string;
  title: string;
  occurred_at: string | null;
  created_at: string;
  added_by: string | null;
  outcome: string | null;
  account_id: string | null;
  engagement_type: string;
  criteria_version: number;
}

export type ScoredCallRow = Row;

/**
 * Every call the signed-in person can read, and its scorecard. RLS bounds it
 * to their company; scores are computed here as on every page, never read
 * from a column. For a page that needs both the rows and the coaching shape,
 * so the calls are fetched and scored once.
 */
export async function loadScoredCalls(
  db: SupabaseClient,
): Promise<{ rows: ScoredCallRow[]; scores: Awaited<ReturnType<typeof scoreConversations>> }> {
  const rows = await readAll<Row>(
    (from, to) =>
      db
        .from('conversations')
        .select('id, company_id, title, occurred_at, created_at, added_by, outcome, account_id, engagement_type, criteria_version')
        .order('id')
        .range(from, to),
    'Could not load calls',
  );
  return { rows, scores: await scoreConversations(db, rows) };
}

/** The coaching shape of calls already loaded and scored. */
export function coachingCallsFrom(
  rows: readonly ScoredCallRow[],
  scores: Awaited<ReturnType<typeof scoreConversations>>,
): CoachingCall[] {
  return rows.map((row) => {
    const card = scores.get(row.id)?.scorecard;
    const heard = card?.criteria.some((criterion) => criterion.status !== 'unobserved') ?? false;
    return {
      id: row.id,
      title: row.title,
      date: row.occurred_at ?? row.created_at,
      addedBy: row.added_by,
      engagementType: row.engagement_type,
      outcome: asOutcome(row.outcome),
      accountId: row.account_id,
      score: card && heard ? card.score : null,
      criteria: (card?.criteria ?? []).map((criterion) => ({
        key: criterion.key,
        label: criterion.label,
        status: criterion.status,
      })),
    };
  });
}

/** Every call the signed-in person can read, scored, in the shape coaching needs. */
export async function loadCoachingCalls(db: SupabaseClient): Promise<CoachingCall[]> {
  const { rows, scores } = await loadScoredCalls(db);
  return coachingCallsFrom(rows, scores);
}
