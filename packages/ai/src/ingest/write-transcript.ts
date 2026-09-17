/**
 * A parsed transcript becomes a conversation, its segments and their
 * embeddings.
 *
 * Chunking happened upstream in @tesserafy/ingest (T0, pure). This is the
 * part that touches the database and the embedding model, and it runs under a
 * service-role key, so every write takes its tenant from the companyId
 * argument and nowhere else.
 *
 * supabase-js cannot span one transaction across several calls, so a failure
 * part-way would otherwise leave a conversation whose segments are missing or
 * unembedded — invisible in the UI, and silently absent from every later
 * search. Instead the conversation is deleted on failure and the error is
 * rethrown: ingest either lands whole or not at all.
 */
import type { SupabaseClient } from '@tesserafy/db';
import type { SegmentDraft } from '@tesserafy/ingest';
import type { Embedder } from '../providers/embedder';
import { isCompanyId, type CompanyId } from '../retrieval/company-id';
import { storeSegmentEmbeddings } from '../retrieval/store';

export interface TranscriptInput {
  readonly title: string;
  /** ISO 8601, or null when the source does not say when the call happened. */
  readonly occurredAt: string | null;
  readonly segments: readonly SegmentDraft[];
}

export interface WriteTranscriptOptions {
  /** A service-role client. */
  readonly db: SupabaseClient;
  readonly embedder: Embedder;
}

export interface WrittenTranscript {
  readonly conversationId: string;
  readonly segmentCount: number;
  readonly embeddedCount: number;
}

interface InsertedSegment {
  id: string;
  index: number;
}

export async function writeTranscript(
  companyId: CompanyId,
  input: TranscriptInput,
  opts: WriteTranscriptOptions,
): Promise<WrittenTranscript> {
  if (!isCompanyId(companyId)) {
    throw new TypeError(
      `writeTranscript() requires a valid companyId, got ${JSON.stringify(companyId)}`,
    );
  }
  if (input.title.trim().length === 0) {
    throw new Error('writeTranscript() requires a title');
  }
  if (input.segments.length === 0) {
    throw new Error('writeTranscript() was given a transcript with no segments');
  }

  const { data: conversation, error: conversationError } = await opts.db
    .from('conversations')
    .insert({
      company_id: companyId,
      title: input.title.trim(),
      occurred_at: input.occurredAt,
    })
    .select('id')
    .single();

  if (conversationError || !conversation) {
    throw new Error(`Creating the conversation failed: ${conversationError?.message ?? 'no row returned'}`, {
      cause: conversationError,
    });
  }

  const conversationId = (conversation as { id: string }).id;

  try {
    const segments = await insertSegments(companyId, conversationId, input.segments, opts.db);
    const embeddedCount = await embedSegments(companyId, segments, input.segments, opts);

    return { conversationId, segmentCount: segments.length, embeddedCount };
  } catch (error) {
    await deleteConversation(companyId, conversationId, opts.db);
    throw error;
  }
}

async function insertSegments(
  companyId: CompanyId,
  conversationId: string,
  drafts: readonly SegmentDraft[],
  db: SupabaseClient,
): Promise<InsertedSegment[]> {
  const payload = drafts.map((draft) => ({
    company_id: companyId,
    conversation_id: conversationId,
    speaker: draft.speaker,
    start_ms: draft.startMs,
    end_ms: draft.endMs,
    text: draft.text,
  }));

  // Ask for start_ms back so the returned ids can be matched to their drafts:
  // an insert does not promise to return rows in the order they were sent.
  const { data, error } = await db.from('segments').insert(payload).select('id, start_ms, text');
  if (error || !data) {
    throw new Error(`Writing segments failed: ${error?.message ?? 'no rows returned'}`, {
      cause: error,
    });
  }

  const rows = data as { id: string; start_ms: number; text: string }[];
  if (rows.length !== drafts.length) {
    throw new Error(`Expected ${drafts.length} segments to be written, got ${rows.length}`);
  }

  return rows.map((row) => {
    const index = drafts.findIndex((d) => d.startMs === row.start_ms && d.text === row.text);
    if (index === -1) {
      throw new Error(`A written segment does not match any draft (id ${row.id})`);
    }
    return { id: row.id, index };
  });
}

async function embedSegments(
  companyId: CompanyId,
  segments: readonly InsertedSegment[],
  drafts: readonly SegmentDraft[],
  opts: WriteTranscriptOptions,
): Promise<number> {
  const embeddings = [];

  // Sequential on purpose. A local Ollama serves one request at a time, so
  // parallelism buys nothing and makes a partial failure harder to reason
  // about.
  for (const segment of segments) {
    const draft = drafts[segment.index]!;
    embeddings.push({
      segmentId: segment.id,
      embedding: await opts.embedder.embed(draft.text),
    });
  }

  return storeSegmentEmbeddings(companyId, embeddings, {
    db: opts.db,
    model: opts.embedder.model,
  });
}

/**
 * Best effort: the cascade removes segments and embeddings with it. A failure
 * here is reported but never replaces the original error, which is the one
 * that explains what went wrong.
 */
async function deleteConversation(
  companyId: CompanyId,
  conversationId: string,
  db: SupabaseClient,
): Promise<void> {
  const { error } = await db
    .from('conversations')
    .delete()
    .eq('id', conversationId)
    .eq('company_id', companyId);

  if (error) {
    console.error(
      `writeTranscript: could not roll back conversation ${conversationId}: ${error.message}`,
    );
  }
}
