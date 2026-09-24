import type { SupabaseClient } from '@tesserafy/db';
import { EMBEDDING_MODEL, type Embedder } from '../providers/embedder';

/**
 * Embedding one conversation's segments, as whoever is signed in.
 *
 * Here, in the retrieval module, because ADR 0008 gives this module every
 * write to the vector table as well as every read. The first version of this
 * lived in apps/web and called `record_segment_embeddings` directly: tenant-
 * safe, since the database takes the company from the conversation, but in the
 * wrong place, and invisible to the guard because the guard matched the table
 * name as a whole word. ADR 0011 records the move, and the guard now names the
 * write functions.
 *
 * The caller's client decides whose write this is: a customer's session for an
 * upload, which `record_segment_embeddings` checks for membership.
 */

/** Rows per write: 384 floats each, so a batch stays a modest request body. */
const WRITE_BATCH = 50;

export async function embedConversation(
  conversationId: string,
  opts: { readonly db: SupabaseClient; readonly embedder: Embedder },
): Promise<{ readonly embedded: number }> {
  const { data: segments, error } = await opts.db
    .from('segments')
    .select('id, text')
    .eq('conversation_id', conversationId)
    .order('start_ms', { ascending: true });
  if (error) throw new Error(`Reading segments failed: ${error.message}`);
  if (!segments || segments.length === 0) return { embedded: 0 };

  const texts = segments.map((segment) => segment.text);
  const vectors = opts.embedder.embedMany
    ? await opts.embedder.embedMany(texts)
    : await Promise.all(texts.map((text) => opts.embedder.embed(text)));

  let embedded = 0;
  for (let start = 0; start < segments.length; start += WRITE_BATCH) {
    const rows = segments.slice(start, start + WRITE_BATCH).map((segment, offset) => ({
      segment_id: segment.id,
      embedding: vectors[start + offset],
    }));
    const { data, error: writeError } = await opts.db.rpc('record_segment_embeddings', {
      p_conversation_id: conversationId,
      p_model: opts.embedder.model || EMBEDDING_MODEL,
      p_rows: rows,
    });
    if (writeError) throw new Error(`Recording embeddings failed: ${writeError.message}`);
    embedded += data ?? 0;
  }

  return { embedded };
}
