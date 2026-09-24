import { createSupabaseEmbedder, embedConversation } from '@tesserafy/ai';
import type { SupabaseClient } from '@tesserafy/db';
import { publicSupabaseEnv } from './env';

/**
 * Making an uploaded call searchable, as the person who uploaded it.
 *
 * gte-small inside Supabase, via the caller's own token, so meeting text goes
 * nowhere it is not already stored. The write itself lives in the retrieval
 * module (ADR 0008, 0011): this file only supplies the caller's session and
 * the embedder. Automatic, unlike extraction, because a vector is not a claim
 * and has no per-call bill.
 */
export async function embedUploadedConversation(
  db: SupabaseClient,
  conversationId: string,
  accessToken: string,
): Promise<{ readonly embedded: number }> {
  return embedConversation(conversationId, {
    db,
    embedder: createSupabaseEmbedder({ url: publicSupabaseEnv().url, token: accessToken }),
  });
}
