import { createSupabaseEmbedder, EMBEDDING_MODEL } from '@tesserafy/ai';
import type { SupabaseClient } from '@tesserafy/db';
import { publicSupabaseEnv } from './env';

/**
 * Making an uploaded call searchable, as the person who uploaded it.
 *
 * Embeddings are what let signals from different calls be grouped into
 * insights. They used to need a model on an operator's machine; they now come
 * from gte-small inside Supabase, so an upload can embed itself — the owner's
 * choice, so that meeting text goes nowhere it is not already stored.
 *
 * Automatic, unlike extraction, for the same reason scoring is: a vector is not
 * a claim about anybody, and there is no per-call model bill behind it. The
 * function runs as the caller (their token), and the vectors are written
 * through `record_segment_embeddings`, which checks their membership and that
 * every segment belongs to this call. No service-role key.
 */

/** Rows per write: 384 floats each, so a batch stays a modest request body. */
const WRITE_BATCH = 50;

export interface EmbedOutcome {
  readonly embedded: number;
}

export async function embedUploadedConversation(
  db: SupabaseClient,
  conversationId: string,
  accessToken: string,
): Promise<EmbedOutcome> {
  const { data: segments, error } = await db
    .from('segments')
    .select('id, text')
    .eq('conversation_id', conversationId)
    .order('start_ms', { ascending: true });
  if (error) throw new Error(`Reading segments failed: ${error.message}`);
  if (!segments || segments.length === 0) return { embedded: 0 };

  const embedder = createSupabaseEmbedder({ url: publicSupabaseEnv().url, token: accessToken });
  const vectors = await embedder.embedMany!(segments.map((segment) => segment.text));

  let embedded = 0;
  for (let start = 0; start < segments.length; start += WRITE_BATCH) {
    const rows = segments.slice(start, start + WRITE_BATCH).map((segment, offset) => ({
      segment_id: segment.id,
      embedding: vectors[start + offset],
    }));
    const { data, error: writeError } = await db.rpc('record_segment_embeddings', {
      p_conversation_id: conversationId,
      p_model: EMBEDDING_MODEL,
      p_rows: rows,
    });
    if (writeError) throw new Error(`Recording embeddings failed: ${writeError.message}`);
    embedded += data ?? 0;
  }

  return { embedded };
}
