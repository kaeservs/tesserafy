import type { CriterionEventRow, SupabaseClient } from '@tesserafy/db';
import { fetchCriteria, fetchCriterionEvents } from '@tesserafy/db';
import { replay, score, type CriteriaSet, type DetectorEvent, type Scorecard } from '@tesserafy/scoring';
import { toScorecard } from './criteria';

/**
 * A past conversation's scorecard, computed rather than stored.
 *
 * This is invariant 1 at the read path. Nothing in the database is a score:
 * `criterion_events` holds quoted spans with confidences, and the number comes
 * out of `score(replay(...))` — the same two pure functions the overlay runs
 * during a live call. A conversation scored last month and the same
 * conversation scored now agree unless the criteria changed, and when the
 * criteria do change, history re-scores instead of silently disagreeing with
 * itself.
 *
 * Each conversation is replayed against the criteria set it pins, not against
 * the newest one. Re-scoring an old call under new criteria is a deliberate
 * act — a script that repoints the conversation — and never a side effect of
 * someone opening a page.
 */

export interface ConversationScore {
  readonly conversationId: string;
  readonly scorecard: Scorecard;
  /** Which criteria set produced it, for the page to show alongside. */
  readonly engagementType: string;
  readonly criteriaVersion: number;
  /** Detector versions that contributed, so a reader can attribute the score. */
  readonly detectors: readonly string[];
}

export interface ScorableConversation {
  readonly id: string;
  readonly engagement_type: string;
  readonly criteria_version: number;
}

function toEvent(row: CriterionEventRow): DetectorEvent {
  const span = {
    segmentId: row.segment_id,
    startMs: row.start_ms,
    endMs: row.end_ms,
    quote: row.quote,
  };

  return row.kind === 'contradiction'
    ? { kind: 'contradiction', criterionKey: row.criterion_key, confidence: row.confidence, span }
    : { kind: 'evidence', criterionKey: row.criterion_key, confidence: row.confidence, span };
}

/**
 * Scorecards for a set of conversations, in one round trip per criteria set.
 *
 * Written for the list page as well as the detail page: scoring twenty
 * conversations one at a time would be twenty round trips to say the same
 * thing, and a dashboard that takes two seconds to tell you how last week went
 * is a dashboard nobody opens.
 *
 * A conversation with no events still gets a scorecard — every criterion
 * unobserved, score zero. That is the honest answer for a call nobody has
 * scored yet, and it is different from an error, which is what a missing entry
 * would look like to the caller.
 */
export async function scoreConversations(
  db: SupabaseClient,
  conversations: readonly ScorableConversation[],
): Promise<Map<string, ConversationScore>> {
  const scores = new Map<string, ConversationScore>();
  if (conversations.length === 0) return scores;

  const events = await fetchCriterionEvents(
    db,
    conversations.map((conversation) => conversation.id),
  );

  const byConversation = new Map<string, CriterionEventRow[]>();
  for (const row of events) {
    const bucket = byConversation.get(row.conversation_id);
    if (bucket) bucket.push(row);
    else byConversation.set(row.conversation_id, [row]);
  }

  // One fetch per distinct criteria set rather than per conversation: a week
  // of discovery calls all pin the same set, and asking for it twenty times
  // would be twenty identical queries.
  const sets = new Map<string, CriteriaSet>();

  for (const conversation of conversations) {
    const setKey = `${conversation.engagement_type}/v${conversation.criteria_version}`;
    let criteriaSet = sets.get(setKey);
    if (!criteriaSet) {
      criteriaSet = toScorecard(
        await fetchCriteria(db, conversation.engagement_type, conversation.criteria_version),
      );
      sets.set(setKey, criteriaSet);
    }

    const rows = byConversation.get(conversation.id) ?? [];
    const state = replay(criteriaSet, rows.map(toEvent));

    scores.set(conversation.id, {
      conversationId: conversation.id,
      scorecard: score(state),
      engagementType: conversation.engagement_type,
      criteriaVersion: conversation.criteria_version,
      detectors: [...new Set(rows.map((row) => row.detector))].sort(),
    });
  }

  return scores;
}

/** One conversation. The same path as the list, so they cannot disagree. */
export async function scoreConversation(
  db: SupabaseClient,
  conversation: ScorableConversation,
): Promise<ConversationScore> {
  const scores = await scoreConversations(db, [conversation]);
  const only = scores.get(conversation.id);
  if (!only) throw new Error(`scoreConversation() produced nothing for ${conversation.id}`);
  return only;
}
