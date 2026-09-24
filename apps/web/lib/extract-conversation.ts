import Anthropic from '@anthropic-ai/sdk';
import { awaitableDatabaseSink, extractSignals, T3_DETECTOR, type ExtractableSegment } from '@tesserafy/ai';
import type { SupabaseClient } from '@tesserafy/db';
import { AUTO_SCORE_MAX_WINDOWS } from './score-upload';
import { windowCount } from './scoring-status';

/**
 * Extraction, when a customer asks for it.
 *
 * `scripts/process.ts` records that extraction is deliberately not automatic:
 * it is Opus, and what it produces are claims about a customer. The owner kept
 * that principle and moved who asks — a person still decides to spend it, but
 * the person is now the customer, pressing "Find insights in this call",
 * rather than an operator with a terminal.
 *
 * It runs as them. Their RLS client reads the transcript; their usage is
 * recorded against their company, which is also how the product knows the
 * pass has run; and the signals are written through
 * `record_extracted_signals`, which finds every quote verbatim in this call's
 * own segments and refuses anything else. No service-role key.
 *
 * It does not embed. Embeddings are what let signals from different calls be
 * grouped into insights, and they still need a model this web request cannot
 * reach. Signals appear on the call straight away; grouping them across calls
 * comes with the embedding change.
 */

export type ExtractOutcome =
  | { readonly status: 'extracted'; readonly recorded: number; readonly rejected: number }
  | { readonly status: 'already_extracted' }
  | { readonly status: 'too_long' }
  | { readonly status: 'nothing_to_extract' };

export async function extractConversation(
  db: SupabaseClient,
  conversationId: string,
  client: Anthropic = new Anthropic(),
): Promise<ExtractOutcome> {
  const { data: conversation, error: conversationError } = await db
    .from('conversations')
    .select('id, company_id')
    .eq('id', conversationId)
    .single();
  if (conversationError) throw new Error(`Reading the conversation failed: ${conversationError.message}`);

  // One run per call. A T3 usage row for this conversation is what the
  // pipeline already counts as "extraction ran", including a run that found
  // nothing — and a call where the customer said nothing worth recording must
  // not be re-extracted on Opus every time somebody presses the button.
  const { count: runs, error: runsError } = await db
    .from('model_usage')
    .select('id', { count: 'exact', head: true })
    .eq('conversation_id', conversationId)
    .eq('tier', 't3');
  if (runsError) throw new Error(`Reading extraction history failed: ${runsError.message}`);
  if ((runs ?? 0) > 0) return { status: 'already_extracted' };

  const { data: rows, error: segmentsError } = await db
    .from('segments')
    .select('id, speaker, start_ms, text')
    .eq('conversation_id', conversationId)
    .order('start_ms', { ascending: true });
  if (segmentsError) throw new Error(`Reading segments failed: ${segmentsError.message}`);

  const segments: ExtractableSegment[] = (rows ?? []).map((row) => ({
    id: row.id,
    speaker: row.speaker,
    startMs: row.start_ms,
    text: row.text,
  }));
  if (segments.length === 0) return { status: 'nothing_to_extract' };

  // The same ceiling as automatic scoring: a call too long to score is a call
  // whose scorecard nobody has, and extracting from it would put claims on a
  // conversation the product has otherwise declined to judge.
  if (windowCount(segments.length) > AUTO_SCORE_MAX_WINDOWS) return { status: 'too_long' };

  const usage = awaitableDatabaseSink({
    db,
    companyId: conversation.company_id,
    conversationId,
    detector: T3_DETECTOR,
  });
  const extraction = await extractSignals(segments, { client, onUsage: usage.sink });
  // Before anything returns: this row is what marks the pass as run.
  await usage.settled();

  if (extraction.signals.length === 0) {
    return { status: 'extracted', recorded: 0, rejected: extraction.rejected.length };
  }

  const { data, error } = await db.rpc('record_extracted_signals', {
    p_conversation_id: conversationId,
    p_detector: extraction.detector,
    p_model: extraction.model,
    p_signals: extraction.signals.map((signal) => ({
      kind: signal.kind,
      summary: signal.summary,
      confidence: signal.confidence,
      evidence: signal.evidence.map((item) => ({ segment_id: item.segmentId, quote: item.quote })),
    })),
  });
  if (error) throw new Error(`Recording signals failed: ${error.message}`);

  const counts = data as { recorded?: number; rejected?: number } | null;
  return {
    status: 'extracted',
    recorded: counts?.recorded ?? 0,
    rejected: extraction.rejected.length + (counts?.rejected ?? 0),
  };
}
