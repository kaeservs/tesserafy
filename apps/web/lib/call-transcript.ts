import { readAll, type SupabaseClient } from '@tesserafy/db';
import type { StoredSegment } from '@tesserafy/ai';

/**
 * Every line of one call, in order, as the person asking (RLS).
 *
 * A plain select stops at PostgREST's thousand rows and says nothing, and an
 * import may hold five thousand. Scoring, extraction, action items and the
 * follow-up each read the transcript that way, so a long call was scored,
 * read and summed up from its first thousand lines and looked finished.
 * Ordered by time and then id, because paging needs an order with no ties
 * and live lines can share a millisecond.
 */
export function readCallTranscript(db: SupabaseClient, conversationId: string): Promise<StoredSegment[]> {
  return readAll<StoredSegment>(
    (from, to) =>
      db
        .from('segments')
        .select('id, speaker, start_ms, end_ms, text')
        .eq('conversation_id', conversationId)
        .order('start_ms')
        .order('id')
        .range(from, to),
    'Reading the transcript',
  );
}
