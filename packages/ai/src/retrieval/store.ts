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

/** The transcript has been imported before, under the same source key. */
export class DuplicateSource extends Error {
  override readonly name = 'DuplicateSource';
}

/** A segment with its vector, ready to be written. Ids are the caller's. */
export interface EmbeddedSegment {
  readonly id: string;
  readonly speaker: string | null;
  readonly startMs: number;
  readonly endMs: number;
  readonly text: string;
  readonly embedding: readonly number[];
}

export interface StoreTranscriptInput {
  readonly title: string;
  /** ISO 8601, or null when the source does not say when the call happened. */
  readonly occurredAt: string | null;
  /** The model that produced the vectors, e.g. 'nomic-embed-text'. */
  readonly model: string;
  /**
   * Stable identifier for the import, unique per company. A re-run with the
   * same key is refused by the database rather than duplicating the
   * conversation.
   */
  readonly sourceKey?: string;
  readonly segments: readonly EmbeddedSegment[];
}

export interface StoreOptions {
  /** A service-role client. */
  readonly db: SupabaseClient;
}

/**
 * Writes a conversation, its segments and their embeddings in one
 * transaction, and returns the new conversation id.
 *
 * The work happens inside `ingest_transcript`, a function body being the only
 * transaction available across several inserts from here. Nothing partial can
 * survive a failure, so there is no cleanup path that could itself fail.
 */
export async function storeTranscript(
  companyId: CompanyId,
  input: StoreTranscriptInput,
  opts: StoreOptions,
): Promise<string> {
  if (!isCompanyId(companyId)) {
    throw new TypeError(
      `storeTranscript() requires a valid companyId, got ${JSON.stringify(companyId)}`,
    );
  }
  if (input.title.trim().length === 0) {
    throw new Error('storeTranscript() requires a title');
  }
  if (input.model.trim().length === 0) {
    throw new Error('storeTranscript() requires the model name that produced the vectors');
  }
  if (input.segments.length === 0) {
    throw new Error('storeTranscript() was given no segments');
  }

  // Checked here as well as by the column type: a wrong-width vector caught
  // in TypeScript names the segment, where Postgres would only name the cast.
  const segments = input.segments.map((segment) => {
    assertEmbedding(segment.embedding);
    return {
      id: segment.id,
      speaker: segment.speaker,
      start_ms: segment.startMs,
      end_ms: segment.endMs,
      text: segment.text,
      embedding: [...segment.embedding],
    };
  });

  const { data, error } = await opts.db.rpc('ingest_transcript', {
    p_company_id: companyId,
    p_title: input.title.trim(),
    // `ingest_transcript` declares p_occurred_at without a default, so it
    // cannot be omitted, and a transcript that carries no date genuinely
    // passes null — the column is nullable and a conversation with no known
    // date is a real case. Generated types do not express a nullable argument,
    // so this is asserted rather than avoided, which is the honest way round:
    // the alternative is giving the function a default purely to satisfy a
    // generator.
    p_occurred_at: input.occurredAt as string,
    p_model: input.model,
    p_segments: segments,
    ...(input.sourceKey ? { p_source_key: input.sourceKey } : {}),
  });

  if (error) {
    // 23505 is the unique index on (company_id, source_key): this transcript
    // is already imported, which a batch run treats as "skip", not "fail".
    if (error.code === '23505') {
      throw new DuplicateSource(
        `A conversation for source "${input.sourceKey}" already exists in this company`,
      );
    }
    throw new Error(`ingest_transcript failed: ${error.message}`, { cause: error });
  }
  if (typeof data !== 'string') {
    throw new Error(`ingest_transcript returned no conversation id (got ${JSON.stringify(data)})`);
  }

  return data;
}

/**
 * The conversation a previous import created for this source, or null.
 *
 * A batch run asks before doing the expensive work — embedding a transcript
 * that is already imported costs the same as embedding a new one.
 */
export async function conversationForSource(
  companyId: CompanyId,
  sourceKey: string,
  opts: StoreOptions,
): Promise<string | null> {
  if (!isCompanyId(companyId)) {
    throw new TypeError(`conversationForSource() requires a valid companyId`);
  }

  const { data, error } = await opts.db.rpc('conversation_for_source', {
    p_company_id: companyId,
    p_source_key: sourceKey,
  });

  if (error) {
    throw new Error(`conversation_for_source failed: ${error.message}`, { cause: error });
  }
  return typeof data === 'string' ? data : null;
}
