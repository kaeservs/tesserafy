import { batches, readAll } from './paged';
import type { SupabaseClient } from '../client';

/**
 * Reading the detector events a past conversation's scorecard is replayed
 * from.
 *
 * Rows, not a scorecard — the same division as fetchCriteria. This package
 * knows how the events are stored; @tesserafy/scoring knows what they mean,
 * and is the only thing allowed to turn them into a status or a number.
 *
 * The segment join is not decoration. A DetectorEvent's span carries the
 * timestamps, and they live on the segment rather than on the event so that a
 * re-segmented transcript cannot leave an event claiming a time its own
 * segment no longer has.
 */

export interface CriterionEventRow {
  readonly conversation_id: string;
  readonly criterion_key: string;
  readonly kind: 'evidence' | 'contradiction';
  readonly confidence: number;
  readonly segment_id: string;
  readonly quote: string;
  readonly quote_start: number;
  readonly quote_end: number;
  readonly detector: string;
  readonly model: string;
  readonly created_at: string;
  /** From the segment, so the span cannot drift from the words it quotes. */
  readonly start_ms: number;
  readonly end_ms: number;
}

interface RawRow {
  conversation_id: string;
  criterion_key: string;
  kind: 'evidence' | 'contradiction';
  confidence: number;
  segment_id: string;
  quote: string;
  quote_start: number;
  quote_end: number;
  detector: string;
  model: string;
  created_at: string;
  segments: { start_ms: number; end_ms: number } | { start_ms: number; end_ms: number }[] | null;
}

const COLUMNS =
  'conversation_id, criterion_key, kind, confidence, segment_id, quote, quote_start, quote_end, detector, model, created_at, segments ( start_ms, end_ms )';

/**
 * Events for one or more conversations, in the order they should be replayed.
 *
 * Replay order is the order the conversation happened in — segment time, then
 * position within the segment — not the order the rows were written. A
 * re-scoring pass that ran criteria in a different order, or a batch that
 * inserted out of sequence, must not produce a different transition history
 * from the same evidence.
 *
 * Latching (invariant 2) means the final status is order-independent anyway.
 * The transitions are not, and they are the audit trail: "confirmed at 04:12
 * by this quote" has to be the same answer every time it is asked.
 */
export async function fetchCriterionEvents(
  db: SupabaseClient,
  conversationIds: readonly string[],
): Promise<CriterionEventRow[]> {
  if (conversationIds.length === 0) return [];

  // Batched and paged: a dashboard scores every call at once, and one request
  // for all of them used to put every id in the URL and take back at most a
  // thousand events — past which calls were scored on part of their evidence,
  // silently. See paged.ts.
  const pages = await Promise.all(
    batches(conversationIds).map((ids) =>
      readAll<RawRow>(
        (from, to) =>
          db
            .from('criterion_events')
            .select(COLUMNS)
            .in('conversation_id', ids)
            .order('id')
            .range(from, to)
            .then(({ data, error }) => ({ data: data as RawRow[] | null, error })),
        'Loading criterion events',
      ),
    ),
  );

  const rows = pages.flat().flatMap((row) => {
    // supabase-js cannot tell a to-one embed from a to-many one without
    // generated types; the foreign key says there is exactly one segment.
    const segment = Array.isArray(row.segments) ? row.segments[0] : row.segments;
    if (!segment) return [];

    const { segments: _segments, ...rest } = row;
    return [{ ...rest, start_ms: segment.start_ms, end_ms: segment.end_ms }];
  });

  return rows.sort(
    (a, b) =>
      a.start_ms - b.start_ms ||
      a.quote_start - b.quote_start ||
      a.criterion_key.localeCompare(b.criterion_key),
  );
}
