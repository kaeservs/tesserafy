/**
 * The guarded retrieve(). ADR 0004.
 *
 * The AI pipeline holds a service-role key, which bypasses RLS. This function,
 * not RLS, is therefore what keeps one customer's words out of another
 * customer's prompts. It is the only code permitted to run a similarity or
 * evidence search — scripts/check-retrieval-guard.mjs fails CI otherwise.
 */
import { vectorArg, type SupabaseClient } from '@tesserafy/db';
import { assertEmbedding, type Embedder } from '../providers/embedder';
import { isCompanyId, type CompanyId } from './company-id';

export type RetrievalQuery =
  | { readonly text: string }
  | { readonly embedding: readonly number[] };

export interface RetrieveOptions {
  /** A service-role client. */
  readonly db: SupabaseClient;
  /** Required when the query is text. */
  readonly embedder?: Embedder;
  /** 1–100. Default 10. */
  readonly limit?: number;
  /** Cosine similarity floor, 0–1. Default 0.5. */
  readonly minSimilarity?: number;
}

/** A quoted, timestamped span — the unit of evidence (invariant 4). */
export interface RetrievedSegment {
  readonly segmentId: string;
  readonly companyId: CompanyId;
  readonly conversationId: string;
  readonly speaker: string | null;
  readonly startMs: number;
  readonly endMs: number;
  readonly text: string;
  readonly similarity: number;
}

/** A row came back belonging to a tenant other than the one asked for. */
export class TenantBoundaryViolation extends Error {
  override readonly name = 'TenantBoundaryViolation';
}

interface MatchSegmentsRow {
  segment_id: string;
  company_id: string;
  conversation_id: string;
  speaker: string | null;
  start_ms: number;
  end_ms: number;
  text: string;
  similarity: number;
}

export async function retrieve(
  companyId: CompanyId,
  query: RetrievalQuery,
  opts: RetrieveOptions,
): Promise<RetrievedSegment[]> {
  // The type already demands a CompanyId; this catches `as any` and plain JS.
  if (!isCompanyId(companyId)) {
    throw new TypeError(`retrieve() requires a valid companyId, got ${JSON.stringify(companyId)}`);
  }

  const limit = opts.limit ?? 10;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new RangeError(`limit must be an integer from 1 to 100, got ${limit}`);
  }
  const minSimilarity = opts.minSimilarity ?? 0.5;
  if (!(minSimilarity >= 0 && minSimilarity <= 1)) {
    throw new RangeError(`minSimilarity must be between 0 and 1, got ${minSimilarity}`);
  }

  const embedding = await resolveEmbedding(query, opts.embedder);

  const { data, error } = await opts.db.rpc('match_segments', {
    p_company_id: companyId,
    p_query_embedding: vectorArg(embedding),
    p_match_count: limit,
    p_min_similarity: minSimilarity,
  });
  if (error) {
    throw new Error(`match_segments failed: ${error.message}`, { cause: error });
  }

  const rows = (data ?? []) as MatchSegmentsRow[];

  // Independent of the SQL filter. A foreign row is never dropped quietly:
  // it means the boundary is broken, and that must surface as a failure.
  const foreign = rows.filter((row) => row.company_id !== companyId);
  if (foreign.length > 0) {
    throw new TenantBoundaryViolation(
      `retrieve() for company ${companyId} received ${foreign.length} row(s) from another company`,
    );
  }

  return rows.map((row) => ({
    segmentId: row.segment_id,
    companyId,
    conversationId: row.conversation_id,
    speaker: row.speaker,
    startMs: row.start_ms,
    endMs: row.end_ms,
    text: row.text,
    similarity: row.similarity,
  }));
}

async function resolveEmbedding(
  query: RetrievalQuery,
  embedder: Embedder | undefined,
): Promise<number[]> {
  if ('embedding' in query) {
    const embedding = [...query.embedding];
    assertEmbedding(embedding);
    return embedding;
  }
  if (!embedder) {
    throw new Error('retrieve() needs an embedder for a text query');
  }
  if (query.text.trim().length === 0) {
    throw new Error('retrieve() text query is empty');
  }
  const embedding = await embedder.embed(query.text);
  assertEmbedding(embedding);
  return embedding;
}
