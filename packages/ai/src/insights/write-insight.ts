/**
 * Persisting an insight and its citations.
 *
 * One transaction, like every other write here. An insight that kept half its
 * citations would overstate how thin its support is — the one lie this
 * product cannot tell — so `store_insight()` writes both or neither.
 */
import type { SupabaseClient } from '@tesserafy/db';
import { isCompanyId, type CompanyId } from '../retrieval/company-id';
import type { SynthesisedInsight } from './synthesise';

export interface WriteInsightOptions {
  /** A service-role client, or a member's session with `asMember`. */
  readonly db: SupabaseClient;
  /**
   * Write through `record_insight`, which checks the caller is a member of
   * the company and that every cited signal belongs to it (ADR 0011). For a
   * customer's own session; the service role uses `store_insight`.
   */
  readonly asMember?: boolean;
}

export async function writeInsight(
  companyId: CompanyId,
  insight: SynthesisedInsight,
  opts: WriteInsightOptions,
): Promise<string> {
  if (!isCompanyId(companyId)) {
    throw new TypeError(
      `writeInsight() requires a valid companyId, got ${JSON.stringify(companyId)}`,
    );
  }
  if (insight.title.trim().length === 0 || insight.summary.trim().length === 0) {
    throw new Error('writeInsight() requires a title and a summary');
  }
  if (insight.signalIds.length === 0) {
    throw new Error('writeInsight() was given an insight with no signals (invariant 4)');
  }

  const fn = opts.asMember ? 'record_insight' : 'store_insight';
  const { data, error } = await opts.db.rpc(fn, {
    p_company_id: companyId,
    p_title: insight.title,
    p_summary: insight.summary,
    p_synthesiser: insight.synthesiser,
    p_model: insight.model,
    p_signal_ids: [...insight.signalIds],
  });

  if (error) {
    throw new Error(`${fn} failed: ${error.message}`, { cause: error });
  }
  if (typeof data !== 'string') {
    throw new Error(`${fn} returned no insight id (got ${JSON.stringify(data)})`);
  }

  return data;
}
