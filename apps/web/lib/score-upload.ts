import Anthropic from '@anthropic-ai/sdk';
import {
  awaitableDatabaseSink,
  scanWindows,
  T1_DETECTOR,
  windowsOf,
} from '@tesserafy/ai';
import { fetchCriteria, type SupabaseClient } from '@tesserafy/db';
import { loadGuidance, purposeOf } from './guidance';

/**
 * Scoring a transcript the moment it arrives, as the person who uploaded it.
 *
 * Until now an upload stopped at "Not scored yet" with a terminal command
 * underneath — a product that only worked for someone who had the operator
 * CLI. This is the same T1 pass `pnpm score` runs, sharing its windowing, and
 * it runs as the customer: their RLS client reads the segments and criteria,
 * and their writes go through `record_criterion_events`, which checks their
 * membership and re-derives every quote's offsets itself. No service-role key
 * is involved, so nothing here widens what the web app can reach.
 *
 * It writes evidence, not a score (invariant 1), and it is not the extraction
 * pass: signals and insights are claims about a customer, and they still wait
 * for a person to ask.
 *
 * A window is 48 utterances (see SCORE_WINDOW_SIZE for why and what it was
 * measured against). One took ~16 s and ~$0.011 at 47 utterances of dense
 * evidence; an hour-long meeting of ~500 utterances is ~11 windows. The
 * previous three-utterance window made that meeting ~500 calls, ~190 s and up
 * to ~$0.95.
 */

/**
 * The largest call scored automatically, in windows: ~1,840 utterances,
 * roughly a three-hour meeting. At the concurrency below that is five rounds
 * of ~20 s, inside the route's 300 s budget; worst case about $0.45. Longer
 * calls are not scored partially: a scorecard over the first part of a meeting
 * would look complete and be wrong.
 */
export const AUTO_SCORE_MAX_WINDOWS = 40;

/** Detector calls in flight at once. */
const CONCURRENCY = 8;

/** Events per write. The RPC checks each quote, so one huge batch is one long lock. */
const WRITE_BATCH = 100;

export type ScoreOutcome =
  | { readonly status: 'scored'; readonly recorded: number; readonly rejected: number; readonly calls: number }
  | { readonly status: 'too_long'; readonly windows: number }
  | { readonly status: 'nothing_to_score' };

export async function scoreUploadedConversation(
  db: SupabaseClient,
  conversationId: string,
  client: Anthropic = new Anthropic(),
): Promise<ScoreOutcome> {
  const { data: conversation, error: conversationError } = await db
    .from('conversations')
    .select('id, company_id, engagement_type, criteria_version')
    .eq('id', conversationId)
    .single();
  if (conversationError) throw new Error(`Reading the conversation failed: ${conversationError.message}`);

  const { data: segments, error: segmentsError } = await db
    .from('segments')
    .select('id, speaker, start_ms, end_ms, text')
    .eq('conversation_id', conversationId)
    .order('start_ms', { ascending: true });
  if (segmentsError) throw new Error(`Reading segments failed: ${segmentsError.message}`);

  const windows = windowsOf(segments ?? []);
  if (windows.length === 0) return { status: 'nothing_to_score' };
  if (windows.length > AUTO_SCORE_MAX_WINDOWS) return { status: 'too_long', windows: windows.length };

  const rows = await fetchCriteria(db, conversation.company_id, conversation.engagement_type, conversation.criteria_version);
  const criteria = rows.map((row) => ({ key: row.key, label: row.label, definition: row.definition }));

  // Awaited rather than fire-and-forget: this runs inside after(), and a
  // write nobody waits for can be cut off when the function freezes. It
  // recorded correctly in production before this change, but by timing.
  const usage = awaitableDatabaseSink({
    db,
    detector: T1_DETECTOR,
    companyId: conversation.company_id,
    conversationId,
  });
  // What the company has taught the detector: examples from corrections,
  // owners' instructions, and what kind of call this scorecard is for.
  const guidance = await loadGuidance(
    db,
    conversation.company_id,
    'scoring',
    conversation.engagement_type,
    await purposeOf(db, conversation.company_id, conversation.engagement_type),
  );
  const scan = await scanWindows(windows, {
    client,
    criteria,
    guidance,
    concurrency: CONCURRENCY,
    onUsage: usage.sink,
  });
  await usage.settled();

  let recorded = 0;
  let rejected = scan.rejected;
  for (let start = 0; start < scan.events.length; start += WRITE_BATCH) {
    const batch = scan.events.slice(start, start + WRITE_BATCH);
    const { data, error } = await db.rpc('record_criterion_events', {
      p_conversation_id: conversationId,
      p_events: batch.map((event) => ({
        criterion_key: event.criterionKey,
        kind: event.kind,
        confidence: event.confidence,
        segment_id: event.segmentId,
        quote: event.quote,
        detector: event.detector,
        model: event.model,
      })),
    });
    if (error) throw new Error(`Recording events failed: ${error.message}`);
    const counts = data as { recorded?: number; rejected?: number } | null;
    recorded += counts?.recorded ?? 0;
    rejected += counts?.rejected ?? 0;
  }

  return { status: 'scored', recorded, rejected, calls: scan.calls };
}
