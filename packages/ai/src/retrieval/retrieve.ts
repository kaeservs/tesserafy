/**
 * The guarded retrieve(). ADR 0004.
 *
 * Two corpora, one function: a company's calls (segments, the default) and
 * its knowledge (passages of the documents it uploaded). Both are searched
 * with companyId first and every row checked against it — a second function
 * would be a second place to get that wrong.
 *
 * The AI pipeline holds a service-role key, which bypasses RLS. This function,
 * not RLS, is therefore what keeps one customer's words out of another
 * customer's prompts. It is the only code permitted to run a similarity or
 * evidence search — scripts/check-retrieval-guard.mjs fails CI otherwise.
 */
import { vectorArg, type SupabaseClient } from '@tesserafy/db';
import { assertEmbedding, RELATED_SIMILARITY, type Embedder } from '../providers/embedder';
import { isCompanyId, type CompanyId } from './company-id';

export type RetrievalQuery =
  | { readonly text: string }
  | { readonly embedding: readonly number[] };

export interface RetrieveOptions {
  /** Which corpus: the company's calls (default) or its knowledge. */
  readonly corpus?: 'calls' | 'knowledge';
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

/** A passage of a company's knowledge, with the document it is from. */
export interface RetrievedPassage {
  readonly chunkId: string;
  readonly companyId: CompanyId;
  readonly documentId: string;
  readonly title: string;
  readonly text: string;
  readonly similarity: number;
  /** Reciprocal-rank fusion of meaning and words; higher is more relevant. */
  readonly score: number;
}

interface MatchKnowledgeRow {
  chunk_id: string;
  company_id: string;
  document_id: string;
  title: string;
  text: string;
  similarity: number;
  score: number;
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
  opts: RetrieveOptions & { readonly corpus?: 'calls' },
): Promise<RetrievedSegment[]>;
export async function retrieve(
  companyId: CompanyId,
  query: RetrievalQuery,
  opts: RetrieveOptions & { readonly corpus: 'knowledge' },
): Promise<RetrievedPassage[]>;
export async function retrieve(
  companyId: CompanyId,
  query: RetrievalQuery,
  opts: RetrieveOptions,
): Promise<RetrievedSegment[] | RetrievedPassage[]> {
  // The type already demands a CompanyId; this catches `as any` and plain JS.
  if (!isCompanyId(companyId)) {
    throw new TypeError(`retrieve() requires a valid companyId, got ${JSON.stringify(companyId)}`);
  }

  const limit = opts.limit ?? 10;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new RangeError(`limit must be an integer from 1 to 100, got ${limit}`);
  }
  // The model's own notion of "related", not a literal: 0.5 meant something
  // for nomic and means "everything" for gte-small (see providers/embedder).
  const minSimilarity = opts.minSimilarity ?? RELATED_SIMILARITY;
  if (!(minSimilarity >= 0 && minSimilarity <= 1)) {
    throw new RangeError(`minSimilarity must be between 0 and 1, got ${minSimilarity}`);
  }

  const embedding = await resolveEmbedding(query, opts.embedder);

  if (opts.corpus === 'knowledge') {
    // Meaning and words together (match_knowledge): the words need the text,
    // so a query given only as a vector is searched by meaning alone.
    const { data, error } = await opts.db.rpc('match_knowledge', {
      p_company_id: companyId,
      p_query_embedding: vectorArg(embedding),
      p_query_text: 'text' in query ? query.text : '',
      p_match_count: Math.min(limit, 20),
    });
    if (error) throw new Error(`match_knowledge failed: ${error.message}`, { cause: error });
    const rows = (data ?? []) as MatchKnowledgeRow[];
    const foreign = rows.filter((row) => row.company_id !== companyId);
    if (foreign.length > 0) {
      throw new TenantBoundaryViolation(
        `retrieve() for company ${companyId} received ${foreign.length} passage(s) from another company`,
      );
    }
    return rows.map((row) => ({
      chunkId: row.chunk_id,
      companyId,
      documentId: row.document_id,
      title: row.title,
      text: row.text,
      similarity: row.similarity,
      score: row.score,
    }));
  }

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
