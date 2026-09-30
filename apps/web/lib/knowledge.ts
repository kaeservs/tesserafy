import { createSupabaseEmbedder, recordFailure, retrieve, storeKnowledge, toCompanyId, type KnowledgePassage } from '@tesserafy/ai';
import type { SupabaseClient } from '@tesserafy/db';
import { DOCUMENT_MAX_CHARS, toPassages } from '@tesserafy/ingest';
import { publicSupabaseEnv } from './env';

/**
 * A company's knowledge: documents its sellers answer from, which the
 * overlay's Assist and Ask quote when the customer asks about the product.
 *
 * A document is read to plain text here (PDF, Word, text or Markdown), split
 * into passages (packages/ingest), embedded by the gte-small function inside
 * Supabase with the owner's own token, and written through storeKnowledge in
 * the retrieval module (ADR 0004): no service key, no new outside service.
 *
 * Not redacted, unlike a call: redaction exists for what customers say, and a
 * company's own pricing sheet quoting its support address is the company's to
 * publish to its sellers.
 */

/** Under Vercel's 4.5 MB request limit, with room for the form around it. */
export const UPLOAD_MAX_BYTES = 4 * 1024 * 1024;

export const KNOWLEDGE_TYPES = ['.pdf', '.docx', '.txt', '.md'] as const;

export class UnreadableDocument extends Error {
  override readonly name = 'UnreadableDocument';
}

/** The plain text of an uploaded file, or UnreadableDocument saying why not. */
export async function documentText(fileName: string, bytes: ArrayBuffer): Promise<string> {
  const name = fileName.toLowerCase();
  let text: string;
  if (name.endsWith('.pdf')) {
    const { extractText, getDocumentProxy } = await import('unpdf');
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    text = (await extractText(pdf, { mergePages: true })).text;
  } else if (name.endsWith('.docx')) {
    const mammoth = await import('mammoth');
    text = (await mammoth.extractRawText({ buffer: Buffer.from(bytes) })).value;
  } else if (name.endsWith('.txt') || name.endsWith('.md')) {
    text = new TextDecoder('utf-8').decode(bytes);
  } else {
    throw new UnreadableDocument(`Tesserafy reads ${KNOWLEDGE_TYPES.join(', ')} files.`);
  }
  // A NUL byte, which some PDFs carry, is not text Postgres will store.
  text = text.split(String.fromCharCode(0)).join('').trim();
  if (text.length < 20) {
    throw new UnreadableDocument('There is no text in it to read. A scanned PDF needs its text recognised first.');
  }
  return text;
}

export type AddOutcome =
  | { status: 'ready'; documentId: string; passages: number; truncated: boolean }
  | { status: 'failed'; documentId: string | null; message: string };

/**
 * Adds a document to the company's knowledge, as the owner calling. Reads,
 * splits, embeds and stores; a document that fails is kept, marked failed and
 * saying why, so the owner sees it rather than wondering where it went.
 */
export async function addDocument(
  db: SupabaseClient,
  token: string,
  companyId: string,
  input: { title: string; source: 'upload' | 'pasted'; fileName?: string | null; text: string },
): Promise<AddOutcome> {
  const { data: documentId, error } = await db.rpc('create_knowledge_document', {
    p_title: input.title,
    p_source: input.source,
    ...(input.fileName ? { p_file_name: input.fileName } : {}),
  });
  if (error || !documentId) {
    return { status: 'failed', documentId: null, message: (error?.message ?? 'It could not be added.').replace(/^[a-z_]+: /, '') };
  }

  const truncated = input.text.length > DOCUMENT_MAX_CHARS;
  const text = truncated ? input.text.slice(0, DOCUMENT_MAX_CHARS) : input.text;
  try {
    const passages = toPassages(text);
    if (passages.length === 0) throw new UnreadableDocument('There is no text in it to read.');
    const { url } = publicSupabaseEnv();
    const stored = await storeKnowledge(toCompanyId(companyId), documentId, passages, text.length, {
      db,
      embedder: createSupabaseEmbedder({ url, token }),
    });
    return { status: 'ready', documentId, passages: stored, truncated };
  } catch (cause) {
    const message =
      cause instanceof UnreadableDocument
        ? cause.message
        : recordFailure(cause, { db, source: 'knowledge/add' }).message || 'It could not be read.';
    await db.rpc('fail_knowledge_document', { p_document_id: documentId, p_error: message });
    return { status: 'failed', documentId, message };
  }
}

/** Whether the company has any knowledge ready to answer from; asked before paying for a search. */
export async function hasKnowledge(db: SupabaseClient, companyId: string): Promise<boolean> {
  const { count } = await db
    .from('knowledge_documents')
    .select('id', { count: 'exact', head: true })
    .eq('company_id', companyId)
    .eq('status', 'ready');
  return (count ?? 0) > 0;
}

/**
 * The passages most relevant to a question, as the overlay's help reads them
 * (k1, k2, …). Searched as the person asking, so the database's own tenant
 * rule applies as well as retrieve()'s.
 */
export async function knowledgeFor(
  db: SupabaseClient,
  token: string,
  companyId: string,
  question: string,
  limit = 4,
): Promise<KnowledgePassage[]> {
  const text = question.trim().slice(0, 1_500);
  if (!text) return [];
  const { url } = publicSupabaseEnv();
  const found = await retrieve(toCompanyId(companyId), { text }, {
    db,
    embedder: createSupabaseEmbedder({ url, token }),
    corpus: 'knowledge',
    limit,
  });
  return found.map((passage, index) => ({ id: `k${index + 1}`, title: passage.title, text: passage.text }));
}
