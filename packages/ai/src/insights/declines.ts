import type { SupabaseClient } from '@tesserafy/db';
import type { CompanyId } from '../retrieval/company-id';

/**
 * Groups synthesis has already judged are not one finding.
 *
 * Clustering is deterministic over unchanged data, so a declined group comes
 * straight back on the next run and Opus is paid again for the same verdict —
 * observed on #81. A decline is remembered against the exact set of signals:
 * add a signal to the group and it is a different group, judged afresh.
 */

/** The signals of a group, sorted and joined — the same as the database builds. */
export function groupSignature(signalIds: readonly string[]): string {
  return [...new Set(signalIds)].sort().join(',');
}

/** Only verdicts are remembered. A synthesis that invented signals is retried. */
export type RememberedDecline = 'declined' | 'too-narrow';

export async function loadDeclined(companyId: CompanyId, db: SupabaseClient): Promise<Set<string>> {
  const { data, error } = await db
    .from('insight_declines')
    .select('signature')
    .eq('company_id', companyId);
  if (error) throw new Error(`Reading declined groups failed: ${error.message}`);
  return new Set((data ?? []).map((row) => row.signature));
}

export async function rememberDecline(
  companyId: CompanyId,
  signalIds: readonly string[],
  reason: RememberedDecline,
  synthesiser: string,
  db: SupabaseClient,
): Promise<void> {
  const { error } = await db.rpc('record_insight_decline', {
    p_company_id: companyId,
    p_signal_ids: [...signalIds],
    p_reason: reason,
    p_synthesiser: synthesiser,
  });
  if (error) throw new Error(`Remembering a declined group failed: ${error.message}`);
}
