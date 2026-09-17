/**
 * A parsed transcript becomes a conversation, its segments and their
 * embeddings.
 *
 * Chunking happened upstream in @tesserafy/ingest (T0, pure). This is the part
 * that touches the embedding model and the database, in that order: embedding
 * is the slow, failure-prone step, so it happens before anything is written,
 * and a model or network failure leaves the database untouched.
 *
 * The write itself is one transaction inside `ingest_transcript` (ADR 0008),
 * so a transcript lands whole or not at all — no compensating delete, which
 * would only be as reliable as the round trip performing it.
 */
import type { SegmentDraft } from '@tesserafy/ingest';
import type { Embedder } from '../providers/embedder';
import { isCompanyId, type CompanyId } from '../retrieval/company-id';
import { storeTranscript, type EmbeddedSegment, type StoreOptions } from '../retrieval/store';

export interface TranscriptInput {
  readonly title: string;
  /** ISO 8601, or null when the source does not say when the call happened. */
  readonly occurredAt: string | null;
  readonly segments: readonly SegmentDraft[];
}

export interface WriteTranscriptOptions extends StoreOptions {
  readonly embedder: Embedder;
  /** Injectable so tests are deterministic; defaults to crypto.randomUUID. */
  readonly newId?: () => string;
}

export interface WrittenTranscript {
  readonly conversationId: string;
  readonly segmentCount: number;
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
  if (input.segments.length === 0) {
    throw new Error('writeTranscript() was given a transcript with no segments');
  }

  const newId = opts.newId ?? (() => crypto.randomUUID());

  // Ids are minted here rather than by the database, so each vector is paired
  // with its own words by construction. Matching rows back by their contents
  // after the fact could mis-pair them, and a vector attached to somebody
  // else's words fails silently, as bad retrieval months later.
  const segments: EmbeddedSegment[] = [];
  for (const draft of input.segments) {
    segments.push({
      id: newId(),
      speaker: draft.speaker,
      startMs: draft.startMs,
      endMs: draft.endMs,
      text: draft.text,
      // Sequential on purpose: a local Ollama serves one request at a time,
      // so parallelism buys nothing here.
      embedding: await opts.embedder.embed(draft.text),
    });
  }

  const conversationId = await storeTranscript(
    companyId,
    {
      title: input.title,
      occurredAt: input.occurredAt,
      model: opts.embedder.model,
      segments,
    },
    { db: opts.db },
  );

  return { conversationId, segmentCount: segments.length };
}
