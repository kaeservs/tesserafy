/**
 * Writing a knowledge document's passages and their vectors. ADR 0004,
 * extended to writes by ADR 0008, as for segments: the vector table is
 * written from this directory only, and the tenant is an argument, never a
 * per-row field.
 *
 * Runs as the owner who uploaded the document (a signed-in client): the
 * embedder is called with their token, and record_knowledge_chunks checks
 * they own the document and that it belongs to the company named here.
 */
import type { SupabaseClient } from '@tesserafy/db';
import { assertEmbedding, type Embedder } from '../providers/embedder';
import { isCompanyId, type CompanyId } from './company-id';

export interface StoreKnowledgeOptions {
  /** The owner's signed-in client. */
  readonly db: SupabaseClient;
  readonly embedder: Embedder;
}

/**
 * Embeds each passage and records them all on the document in one call, which
 * makes it ready; returns how many were stored. Nothing is stored unless every
 * passage embedded: a document half in the knowledge would answer from half.
 */
export async function storeKnowledge(
  companyId: CompanyId,
  documentId: string,
  passages: readonly string[],
  characters: number,
  opts: StoreKnowledgeOptions,
): Promise<number> {
  if (!isCompanyId(companyId)) {
    throw new TypeError(`storeKnowledge() requires a valid companyId, got ${JSON.stringify(companyId)}`);
  }
  if (passages.length === 0) throw new Error('storeKnowledge() was given no passages');

  const embeddings = opts.embedder.embedMany
    ? await opts.embedder.embedMany(passages)
    : await Promise.all(passages.map((passage) => opts.embedder.embed(passage)));
  if (embeddings.length !== passages.length) {
    throw new Error(`storeKnowledge(): ${passages.length} passages but ${embeddings.length} vectors`);
  }
  embeddings.forEach((embedding) => assertEmbedding(embedding));

  // The document must be this company's; the database checks the caller owns it.
  const { data: document, error: readError } = await opts.db
    .from('knowledge_documents')
    .select('company_id')
    .eq('id', documentId)
    .maybeSingle();
  if (readError) throw new Error(`reading the document failed: ${readError.message}`, { cause: readError });
  if (!document || document.company_id !== companyId) {
    throw new Error(`storeKnowledge(): document ${documentId} is not company ${companyId}'s`);
  }

  const { data, error } = await opts.db.rpc('record_knowledge_chunks', {
    p_document_id: documentId,
    p_chunks: passages.map((text, ordinal) => ({ ordinal, text, embedding: embeddings[ordinal]! })),
    p_characters: characters,
  });
  if (error) throw new Error(`record_knowledge_chunks failed: ${error.message}`, { cause: error });
  return data ?? passages.length;
}
