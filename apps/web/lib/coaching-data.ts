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
  engagement_type: string;
  criteria_version: number;
}

/**
 * Every call the signed-in person can read, scored, in the shape coaching
 * needs. RLS bounds it to their company; scores are computed here as on every
 * page, never read from a column.
 */
export async function loadCoachingCalls(db: SupabaseClient): Promise<CoachingCall[]> {
  const rows = await readAll<Row>(
    (from, to) =>
      db
        .from('conversations')
        .select('id, company_id, title, occurred_at, created_at, added_by, outcome, engagement_type, criteria_version')
        .order('id')
        .range(from, to),
    'Could not load calls',
  );
  const scores = await scoreConversations(db, rows);
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
      score: card && heard ? card.score : null,
      criteria: (card?.criteria ?? []).map((criterion) => ({
        key: criterion.key,
        label: criterion.label,
        status: criterion.status,
      })),
    };
  });
}
