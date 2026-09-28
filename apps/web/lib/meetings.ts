import { readAll, type SupabaseClient } from '@tesserafy/db';
import { likePattern, parseFilters, type MeetingFilters } from './meeting-filters';
import { scoreConversations, type ConversationScore } from './scorecard';

export interface MeetingRow {
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

export interface ScoredMeeting extends MeetingRow {
  readonly card: ConversationScore | undefined;
  /** Null when nothing was heard: not scored, which is not zero. */
  readonly score: number | null;
}

/**
 * The meetings a URL asks for, scored — shared by the Meetings page and its
 * CSV so the two cannot disagree about which calls match.
 *
 * Narrows in SQL on stored columns and scores what is left; the caller applies
 * dates, score band and sort (lib/meeting-filters.ts). A member's seller
 * filter is themselves or nothing, whatever the URL says.
 */
export async function findMeetings(
  db: SupabaseClient,
  params: Record<string, string | string[] | undefined>,
  viewer: { userId: string | null; isOwner: boolean },
): Promise<{ filters: MeetingFilters; meetings: ScoredMeeting[] }> {
  const asked = parseFilters(params);
  const filters =
    asked.seller && asked.seller !== 'mine' && !viewer.isOwner ? { ...asked, seller: 'mine' } : asked;
  const sellerId = filters.seller === 'mine' ? (viewer.userId ?? '') : filters.seller;

  // Every call that passes the stored-column filters, not the first thousand.
  const rows = await readAll<MeetingRow>((from, to) => {
    let query = db
      .from('conversations')
      .select('id, company_id, title, occurred_at, created_at, added_by, outcome, account_id, engagement_type, criteria_version');
    if (filters.q) query = query.ilike('title', likePattern(filters.q));
    if (sellerId) query = query.eq('added_by', sellerId);
    if (filters.type) query = query.eq('engagement_type', filters.type);
    if (filters.account) query = query.eq('account_id', filters.account);
    if (filters.outcome === 'none') query = query.is('outcome', null);
    else if (filters.outcome) query = query.eq('outcome', filters.outcome);
    return query.order('occurred_at', { ascending: false }).order('id').range(from, to);
  }, 'Could not load conversations');

  const scores = await scoreConversations(db, rows);
  const meetings = rows.map((row) => {
    const card = scores.get(row.id);
    const observed = card?.scorecard.criteria.some((c) => c.status !== 'unobserved') ?? false;
    return { ...row, card, score: card && observed ? card.scorecard.score : null };
  });
  return { filters, meetings };
}
