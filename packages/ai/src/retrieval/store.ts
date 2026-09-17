/**
 * Writing to the vector table. ADR 0004, extended to writes by ADR 0008.
 *
 * The same argument as retrieve(): this runs under a service-role key, so RLS
 * is not in the path. A row written with the wrong company_id is worse than a
 * query that reads the wrong one — a bad read is a bug for as long as it runs,
 * a bad write is a leak that outlives it and reappears in every later search.
 *
 * So the tenant comes from one place: the companyId argument. Callers do not
 * supply company_id per row, and cannot.
 */
import type { SupabaseClient } from '@tesserafy/db';
import { assertEmbedding } from '../providers/embedder';
import { isCompanyId, type CompanyId } from './company-id';

export interface SegmentEmbedding {
  readonly segmentId: string;
  readonly embedding: readonly number[];
}

export interface StoreOptions {
  /** A service-role client. */
  readonly db: SupabaseClient;
  /** The model that produced these vectors, e.g. 'nomic-embed-text'. */
  readonly model: string;
}

/**
 * Stores one embedding per segment, and returns how many were written.
 *
 * The insert relies on the composite foreign key (company_id, segment_id) to
 * reject a segment that belongs to another tenant: the database refuses the
 * row rather than this code trusting its caller.
 */
export async function storeSegmentEmbeddings(
  companyId: CompanyId,
  rows: readonly SegmentEmbedding[],
  opts: StoreOptions,
): Promise<number> {
  if (!isCompanyId(companyId)) {
    throw new TypeError(
      `storeSegmentEmbeddings() requires a valid companyId, got ${JSON.stringify(companyId)}`,
    );
  }
  if (opts.model.trim().length === 0) {
    throw new Error('storeSegmentEmbeddings() requires the model name that produced the vectors');
  }
  if (rows.length === 0) return 0;

  const payload = rows.map((row) => {
    assertEmbedding(row.embedding);
    return {
      segment_id: row.segmentId,
      company_id: companyId,
      embedding: [...row.embedding],
      model: opts.model,
    };
  });

  const { error } = await opts.db.from('segment_embeddings').insert(payload);
  if (error) {
    throw new Error(`Storing segment embeddings failed: ${error.message}`, { cause: error });
  }

  return payload.length;
}
