/**
 * Persisting what T3 extracted.
 *
 * Every signal and all of its evidence are written in one transaction inside
 * `store_signals()`. A signal without evidence is rejected by the database at
 * commit (ADR 0007), and a conversation that kept half its findings would look
 * analysed while quietly being incomplete — the kind of gap nobody notices
 * because there is nothing to see.
 *
 * The tenant comes from the companyId argument, as everywhere else that runs
 * under a service-role key.
 */
import type { SupabaseClient } from '@tesserafy/db';
import { isCompanyId, type CompanyId } from '../retrieval/company-id';
import type { ResolvedSignal } from '../tiers/evidence';

export interface WriteSignalsInput {
  readonly conversationId: string;
  /** Which prompt produced these, e.g. 't3-extract@2026-09-17'. */
  readonly detector: string;
  readonly model: string;
  readonly signals: readonly ResolvedSignal[];
}

export interface WriteSignalsOptions {
  /** A service-role client. */
  readonly db: SupabaseClient;
}

export async function writeSignals(
  companyId: CompanyId,
  input: WriteSignalsInput,
  opts: WriteSignalsOptions,
): Promise<string[]> {
  if (!isCompanyId(companyId)) {
    throw new TypeError(
      `writeSignals() requires a valid companyId, got ${JSON.stringify(companyId)}`,
    );
  }
  if (input.detector.trim().length === 0 || input.model.trim().length === 0) {
    throw new Error('writeSignals() requires the detector and model that produced the signals');
  }

  // An extraction that found nothing is a result, not a failure. Returning
  // early keeps that distinction out of the database's error path.
  if (input.signals.length === 0) return [];

  for (const signal of input.signals) {
    if (signal.evidence.length === 0) {
      throw new Error(`Signal "${signal.summary}" has no evidence (invariant 4)`);
    }
  }

  const payload = input.signals.map((signal) => ({
    kind: signal.kind,
    summary: signal.summary,
    confidence: signal.confidence,
    evidence: signal.evidence.map((item) => ({
      segment_id: item.segmentId,
      quote: item.quote,
      quote_start: item.quoteStart,
      quote_end: item.quoteEnd,
    })),
  }));

  const { data, error } = await opts.db.rpc('store_signals', {
    p_company_id: companyId,
    p_conversation_id: input.conversationId,
    p_detector: input.detector,
    p_model: input.model,
    p_signals: payload,
  });

  if (error) {
    throw new Error(`store_signals failed: ${error.message}`, { cause: error });
  }

  const ids = Array.isArray(data) ? (data as string[]) : [];
  if (ids.length !== input.signals.length) {
    throw new Error(`Expected ${input.signals.length} signals to be written, got ${ids.length}`);
  }

  return ids;
}
