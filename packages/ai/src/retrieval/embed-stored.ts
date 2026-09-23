/**
 * Giving vectors to segments that are already written. ADR 0008.
 *
 * The model that made a vector is the embedder's own `model`, never a second
 * argument: two sources for one fact is how a row ends up labelled with a
 * model that did not produce it, and that mislabelling is invisible until
 * somebody tries to re-embed only what is stale.
 *
 * `storeTranscript()` embeds and writes together, which is right for an
 * import and impossible for a live call: those segments arrived one at a time
 * while somebody was talking, long before anything could embed them. The
 * result was a quiet hole — a live call scored and appeared on the dashboard,
 * had no vectors, and so could never be found by `retrieve()` or contribute
 * to an insight.
 *
 * This lives beside retrieve() and storeTranscript() rather than in the
 * script that calls it, for the reason ADR 0004's guard exists: nothing
 * outside this directory may name the embeddings table, because a write
 * against the wrong tenant is a leak that outlives the bug and comes back in
 * every later search. The tenant comes from the companyId argument, and the
 * database checks it again against each segment's own company.
 */
import type { SupabaseClient } from '@tesserafy/db';
import { assertEmbedding, type Embedder } from '../providers/embedder';
import { isCompanyId, type CompanyId } from './company-id';

export interface PendingSegment {
  readonly id: string;
  readonly speaker: string | null;
  readonly startMs: number;
  readonly endMs: number;
  readonly text: string;
}

export interface EmbedStoredOptions {
  /** A service-role client. */
  readonly db: SupabaseClient;
  readonly embedder: Embedder;
  /** Segments per round trip. Keeps one failure from costing the whole pass. */
  readonly batchSize?: number;
}

const DEFAULT_BATCH = 32;

interface PendingRow {
  id: string;
  speaker: string | null;
  start_ms: number;
  end_ms: number;
  text: string;
}

/**
 * Segments in this company that have no vector yet.
 *
 * Scoped to a conversation when one is given. The query itself is a database
 * function, so the embeddings table is named in SQL and in this directory and
 * nowhere else.
 */
export async function pendingEmbeddings(
  companyId: CompanyId,
  opts: { db: SupabaseClient; conversationId?: string },
): Promise<PendingSegment[]> {
  if (!isCompanyId(companyId)) {
    throw new TypeError(`pendingEmbeddings() requires a valid companyId, got ${JSON.stringify(companyId)}`);
  }

  const { data, error } = await opts.db.rpc('segments_without_embeddings', {
    p_company_id: companyId,
    // Absent rather than null: the argument has `default null`, and the
    // generated types describe absence.
    ...(opts.conversationId ? { p_conversation_id: opts.conversationId } : {}),
  });
  if (error) {
    throw new Error(`Listing unembedded segments failed: ${error.message}`, { cause: error });
  }

  return ((data ?? []) as PendingRow[]).map((row) => ({
    id: row.id,
    speaker: row.speaker,
    startMs: row.start_ms,
    endMs: row.end_ms,
    text: row.text,
  }));
}

export interface EmbedStoredResult {
  readonly embedded: number;
  /** Segments the database did not accept — almost always another tenant's. */
  readonly skipped: number;
}

/**
 * Embed the given segments and store their vectors.
 *
 * Written in batches so a failure halfway through leaves the earlier batches
 * done rather than nothing done: the pass is safe to re-run, because
 * `pendingEmbeddings()` will simply not return what already has a vector.
 */
export async function embedStoredSegments(
  companyId: CompanyId,
  segments: readonly PendingSegment[],
  opts: EmbedStoredOptions,
): Promise<EmbedStoredResult> {
  if (!isCompanyId(companyId)) {
    throw new TypeError(`embedStoredSegments() requires a valid companyId, got ${JSON.stringify(companyId)}`);
  }
  if (segments.length === 0) return { embedded: 0, skipped: 0 };

  const batchSize = opts.batchSize ?? DEFAULT_BATCH;
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 500) {
    throw new RangeError(`batchSize must be an integer from 1 to 500, got ${batchSize}`);
  }

  let embedded = 0;

  for (let start = 0; start < segments.length; start += batchSize) {
    const batch = segments.slice(start, start + batchSize);

    const rows = await Promise.all(
      batch.map(async (segment) => {
        const embedding = await opts.embedder.embed(segment.text);
        assertEmbedding(embedding);
        return { segment_id: segment.id, embedding };
      }),
    );

    const { data, error } = await opts.db.rpc('embed_stored_segments', {
      p_company_id: companyId,
      p_model: opts.embedder.model,
      p_rows: rows,
    });
    if (error) {
      throw new Error(`Writing embeddings failed: ${error.message}`, { cause: error });
    }
    embedded += (data as number) ?? 0;
  }

  // A row the database declined is one whose segment does not belong to this
  // company. It cannot happen through pendingEmbeddings(), which only returns
  // this tenant's — so if it is ever non-zero, the caller built the list some
  // other way and the count is worth surfacing rather than swallowing.
  return { embedded, skipped: segments.length - embedded };
}
