import { inflateRawSync } from 'node:zlib';
import { createSupabaseEmbedder, retrieve, storeKnowledge, toCompanyId, type KnowledgePassage } from '@tesserafy/ai';
import { recordFailure } from '@/lib/keep-alive';
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

/** What a Word file may unpack to, all its parts together. A real one is a few megabytes. */
export const DOCX_MAX_UNPACKED_BYTES = 64 * 1024 * 1024;

/**
 * Whether a .docx unpacks to no more than `limit` bytes, by inflating each
 * part with a hard cap rather than trusting the sizes its directory claims.
 * A Word file is a zip, and a 4 MB zip can inflate a thousandfold: the parser
 * reads it whole, so an unchecked one runs the function out of memory
 * (security review, 2026-10-12).
 */
export function docxFitsIn(bytes: Uint8Array, limit = DOCX_MAX_UNPACKED_BYTES): boolean {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // The end-of-central-directory record, within the last 64 KB of comment room.
  let end = -1;
  for (let at = bytes.length - 22; at >= Math.max(0, bytes.length - 22 - 65_535); at--) {
    if (view.getUint32(at, true) === 0x06054b50) {
      end = at;
      break;
    }
  }
  if (end < 0) return false;
  const entries = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  let budget = limit;
  for (let n = 0; n < entries; n++) {
    if (at + 46 > bytes.length || view.getUint32(at, true) !== 0x02014b50) return false;
    const method = view.getUint16(at + 10, true);
    const packed = view.getUint32(at + 20, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const local = view.getUint32(at + 42, true);
    if (local + 30 > bytes.length || view.getUint32(local, true) !== 0x04034b50) return false;
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const data = bytes.subarray(start, start + packed);
    if (method === 0) {
      budget -= data.length;
    } else if (method === 8) {
      try {
        budget -= inflateRawSync(data, { maxOutputLength: Math.max(1, budget) }).length;
      } catch {
        return false;
      }
    } else {
      return false;
    }
    if (budget < 0) return false;
    at += 46 + nameLength + extraLength + commentLength;
  }
  return true;
}

/**
 * What a PDF's streams may inflate to, all together, leaving out its images,
 * which are never read for text. Chosen as the Word file's was, from real
 * ones: a 66-page manual's streams inflate to 0.9 MB, and a 20-slide deck's
 * to under 0.1 MB once its 124 MB of screenshots are left out. pdf.js holds
 * what it decodes more than twice over, so the most this lets through peaked
 * at 205 MB (60 MB of page content, read in a second, measured).
 */
export const PDF_MAX_INFLATED_BYTES = 64 * 1024 * 1024;

const STREAM = Buffer.from('stream');
const ENDSTREAM = Buffer.from('endstream');

/** An empty zlib stream, bare and in ASCII85: what an image's data becomes in the copy pdf.js reads. */
const EMPTY_ZLIB = Uint8Array.from([0x78, 0x9c, 0x03, 0x00, 0x00, 0x00, 0x00, 0x01]);
const EMPTY_ZLIB_A85 = new TextEncoder().encode('Ganj9!!!!"~>');

/** Filters pdf.js applies that are not measured here: the image codecs, and the ones that are not zlib. */
const UNMEASURED = new Set([
  'DCTDecode', 'DCT', 'JPXDecode', 'JBIG2Decode', 'CCITTFaxDecode', 'CCF',
  'LZWDecode', 'LZW', 'RunLengthDecode', 'RL', 'BrotliDecode', 'ASCIIHexDecode', 'AHx',
]);

/** PDF's whitespace and delimiters, which end a name or a keyword. The end of the data does too. */
const BOUNDARY = new Set([0x00, 0x09, 0x0a, 0x0c, 0x0d, 0x20, ...[...'()<>[]{}/%'].map((c) => c.charCodeAt(0))]);
const ends = (byte: number | undefined) => byte === undefined || BOUNDARY.has(byte);
const whitespace = (byte: number | undefined) => byte === 0x00 || byte === 0x09 || byte === 0x0a || byte === 0x0c || byte === 0x0d || byte === 0x20;

function hexDigit(byte: number | undefined): number {
  if (byte === undefined) return -1;
  if (byte >= 0x30 && byte <= 0x39) return byte - 0x30;
  if (byte >= 0x41 && byte <= 0x46) return byte - 0x37;
  if (byte >= 0x61 && byte <= 0x66) return byte - 0x57;
  return -1;
}

/** The name after a slash, `#xx` decoded as pdf.js decodes it, and where it ends. */
function readName(data: Uint8Array, from: number): { name: string; end: number } {
  let name = '';
  let at = from;
  for (; !ends(data[at]); at++) {
    // Kept short: every name that matters here is, and a long one is not one of them.
    const escaped = data[at] === 0x23 && hexDigit(data[at + 1]) >= 0 && hexDigit(data[at + 2]) >= 0;
    if (name.length < 64) {
      name += String.fromCharCode(escaped ? hexDigit(data[at + 1]) * 16 + hexDigit(data[at + 2]) : data[at]!);
    }
    if (escaped) at += 2;
  }
  return { name, end: at };
}

/**
 * The names in a stretch of PDF syntax, in order, with the brackets of arrays
 * and a blank for any other value. Strings, hex strings and comments are
 * passed over as pdf.js passes over them, so a name inside one is not taken
 * for part of a dictionary.
 */
function* namesIn(data: Uint8Array): Generator<string> {
  let at = 0;
  while (at < data.length) {
    const byte = data[at]!;
    if (byte === 0x25) {
      while (at < data.length && data[at] !== 0x0a && data[at] !== 0x0d) at++;
    } else if (byte === 0x28) {
      yield '';
      for (let depth = 1, i = at + 1; ; i++) {
        if (i >= data.length || (data[i] === 0x29 && --depth === 0)) {
          at = i + 1;
          break;
        }
        if (data[i] === 0x5c) i++;
        else if (data[i] === 0x28) depth++;
      }
    } else if (byte === 0x2f) {
      const { name, end } = readName(data, at + 1);
      yield name;
      at = end;
    } else if (byte === 0x5b || byte === 0x5d) {
      yield byte === 0x5b ? '[' : ']';
      at++;
    } else if (byte === 0x3c) {
      // `<<` opens a dictionary; a single `<` opens a hex string.
      const dictionary = data[at + 1] === 0x3c;
      if (!dictionary) yield '';
      const close = dictionary ? at + 1 : data.indexOf(0x3e, at);
      at = close === -1 ? data.length : close + 1;
    } else if (ends(byte)) {
      at++;
    } else {
      yield '';
      while (!ends(data[at])) at++;
    }
  }
}

/** Whether a stream's dictionary makes it an image, or names a filter not measured here. */
function notReadForText(dictionary: Uint8Array): boolean {
  let previous = '';
  // Inside an array given as a /Filter (or pdf.js's /F), where each name is one.
  let filters = false;
  for (const name of namesIn(dictionary)) {
    if (previous === 'Subtype' && name === 'Image') return true;
    const filter = previous === 'Filter' || previous === 'F';
    if ((filter || filters) && UNMEASURED.has(name)) return true;
    if (filter && name === '[') filters = true;
    else if (name === ']') filters = false;
    previous = name;
  }
  return false;
}

/** Whether data begins as zlib does, by the header pdf.js checks before it inflates. */
function zlibHeader(data: Uint8Array): boolean {
  const cmf = data[0] ?? 0;
  const flg = data[1] ?? 0;
  return data.length > 1 && (cmf & 0x0f) === 8 && cmf >> 4 <= 7 && (cmf * 256 + flg) % 31 === 0 && (flg & 0x20) === 0;
}

/** ASCII85 decoded as pdf.js decodes it: whitespace passed over, `z` four zeros, `~` the end, anything else a digit. */
function ascii85(data: Uint8Array): Uint8Array {
  const out = new Uint8Array(data.length * 4);
  let length = 0;
  let group: number[] = [];
  const emit = (digits: number[], count: number) => {
    let value = 0;
    for (const digit of digits) value = value * 85 + (digit - 0x21);
    const bytes = [0, 0, 0, 0];
    for (let i = 3; i >= 0; i--) {
      bytes[i] = value & 0xff;
      value >>= 8;
    }
    out.set(bytes.slice(0, count), length);
    length += count;
  };
  for (const byte of data) {
    if (whitespace(byte)) continue;
    if (byte === 0x7e) break;
    if (byte === 0x7a && group.length === 0) {
      length += 4;
      continue;
    }
    group.push(byte);
    if (group.length === 5) {
      emit(group, 4);
      group = [];
    }
  }
  if (group.length > 1) emit([...group, 0x75, 0x75, 0x75, 0x75].slice(0, 5), group.length - 1);
  return out.subarray(0, length);
}

/**
 * The zlib data pdf.js would inflate from a stream's bytes, if any: the bytes
 * themselves, or under ASCII85, which is how ReportLab writes every page.
 * Decided by the data, not the dictionary. ASCII85 is taken when the first
 * five characters are its digits and decode to a zlib header, which zlib
 * hidden under ASCII85 cannot avoid: pdf.js reads those five as the header.
 */
function zlibIn(body: Uint8Array): { data: Uint8Array; ascii85: boolean } | null {
  if (zlibHeader(body)) return { data: body, ascii85: false };
  const first: number[] = [];
  for (let at = 0; at < body.length && first.length < 5; at++) {
    const byte = body[at]!;
    if (whitespace(byte)) continue;
    if (byte < 0x21 || byte > 0x75) return null;
    first.push(byte);
  }
  if (first.length < 5 || !zlibHeader(ascii85(Uint8Array.from(first)))) return null;
  return { data: ascii85(body), ascii85: true };
}

/**
 * Every `stream` keyword pdf.js could read as one, wherever it is: where its
 * data starts (the next line, as pdf.js skips to it) and where the next
 * endstream is. The data runs to that endstream however long the dictionary
 * says it is, so zlib data that runs past it is truncated here and refused.
 */
function* streamsIn(data: Buffer): Generator<{ keyword: number; start: number; end: number }> {
  let lineEnd = -1;
  let next = -1;
  for (let keyword = data.indexOf(STREAM); keyword !== -1; keyword = data.indexOf(STREAM, keyword + 1)) {
    if (!ends(data[keyword - 1]) || !ends(data[keyword + STREAM.length])) continue;
    // Remembered between keywords, so a file of keywords with no line end or
    // no endstream after them costs one pass, not one pass each.
    if (lineEnd !== data.length && lineEnd < keyword) {
      const lf = data.indexOf(0x0a, keyword);
      const cr = data.indexOf(0x0d, keyword);
      lineEnd = lf === -1 && cr === -1 ? data.length : Math.min(...[lf, cr].filter((at) => at !== -1));
    }
    const start = lineEnd + (data[lineEnd] === 0x0d && data[lineEnd + 1] === 0x0a ? 2 : 1);
    if (next !== data.length && next < start) {
      const found = data.indexOf(ENDSTREAM, start);
      next = found === -1 ? data.length : found;
    }
    yield { keyword, start: Math.min(start, data.length), end: Math.max(next, Math.min(start, data.length)) };
  }
}

/** Whether a PDF is encrypted: its trailer names an /Encrypt dictionary, however the name is spelled. */
function encrypted(data: Buffer): boolean {
  for (let at = data.indexOf(0x2f); at !== -1; at = data.indexOf(0x2f, at + 1)) {
    if ((data[at + 1] === 0x45 || data[at + 1] === 0x23) && readName(data, at + 1).name === 'Encrypt') return true;
  }
  return false;
}

/**
 * The bytes of a PDF that pdf.js may read for its text, or null when they
 * would unpack too far to read safely.
 *
 * pdf.js inflates a stream whole when it reads it: a 512 KB PDF holding one
 * stream of zeros took 1.1 GB to read (1.5 GB when the security review found
 * it), and an upload may be 4 MB. So each stream is inflated here first, with
 * a hard cap and against one budget for the file, the way docxFitsIn treats a
 * Word file's parts, and a stream that will not inflate, or that runs past
 * its endstream, refuses the file. A stream is taken for zlib by its data,
 * not by its dictionary, so no spelling of FlateDecode, and no stream hidden
 * inside an object stream, goes uncounted.
 *
 * Images are left out of the count: a deck of screenshots is mostly image,
 * and none of it is read for text. They are left out by blanking them in the
 * copy pdf.js reads, not by trusting their dictionaries, because pdf.js will
 * decode a stream as a page's content whatever its dictionary calls it. A
 * stream whose filters are not measured here — the image codecs, LZW,
 * RunLength, Brotli, ASCIIHex — is blanked the same way. An encrypted PDF is
 * refused: its streams cannot be measured until they are decrypted.
 */
export function pdfForText(bytes: Uint8Array, limit = PDF_MAX_INFLATED_BYTES): Uint8Array | null {
  const data = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (encrypted(data)) return null;
  let budget = limit;
  let copy: Uint8Array | null = null;

  const inflate = (zlib: Uint8Array, depth: number): boolean => {
    let out: Buffer;
    try {
      out = inflateRawSync(zlib.subarray(2), { maxOutputLength: Math.max(1, budget) });
    } catch {
      return false;
    }
    budget -= out.length;
    if (budget < 0) return false;
    // pdf.js reads a stream inside an object stream too, which no real
    // producer writes; one level is counted, and a second refused.
    let inside = 0;
    for (const { start, end } of streamsIn(out)) {
      inside += end - start;
      if (inside > out.length) return false;
      const inner = zlibIn(out.subarray(start, end));
      if (inner && (depth >= 1 || !inflate(inner.data, depth + 1))) return false;
    }
    return true;
  };

  // A stream's dictionary is read as everything since the last stream that
  // ended before its keyword, so text inside a dictionary that looks like a
  // stream starting cannot cut it short. In a real file nothing overlaps and
  // all of it adds up to less than the file; twice the file is a file built
  // to make this read it again and again.
  let floor = 0;
  let previous = 0;
  let read = 0;
  for (const { keyword, start, end } of streamsIn(data)) {
    if (previous <= keyword) floor = previous;
    read += keyword - floor + (end - start);
    if (read > 2 * data.length) return null;
    const zlib = zlibIn(data.subarray(start, end));
    if (notReadForText(data.subarray(floor, keyword))) {
      // A copy, never the caller's bytes: Buffer's own slice() would be a view.
      copy ??= new Uint8Array(data);
      copy.fill(0x20, start, end);
      const empty = zlib ? (zlib.ascii85 ? EMPTY_ZLIB_A85 : EMPTY_ZLIB) : null;
      if (empty && end - start >= empty.length) copy.set(empty, start);
    } else if (zlib && !inflate(zlib.data, 0)) {
      return null;
    }
    previous = Math.min(data.length, end + ENDSTREAM.length);
  }
  return copy ?? bytes;
}

/**
 * The most pages read from one PDF; a longer one is refused before a page is
 * read. Tesserafy keeps a document's first 250,000 characters, about 150
 * pages of text, and every page can make pdf.js decode a stream again.
 */
export const PDF_MAX_PAGES = 1_000;

/**
 * How long reading a PDF's pages may take, all of them together. A stream is
 * counted once however many pages share it, and each of them decodes it
 * again: 200 pages over one 8 MB stream took 16 seconds. This is what bounds
 * that, well inside the route's two minutes.
 */
const PDF_READ_MS = 45_000;

/**
 * A PDF's text, one page at a time. unpdf's extractText reads every page at
 * once, and pages sharing one stream then each hold it decoded at the same
 * time: 200 pages over one 8 MB stream peaked at 1.9 GB that way, and at
 * 125 MB this way, with the same text. Joined as extractText joins pages.
 */
async function pdfText(bytes: Uint8Array): Promise<string> {
  const readable = pdfForText(bytes);
  if (!readable) {
    throw new UnreadableDocument(
      'That PDF could not be read safely. Save it again, without a password if it has one, or paste the part that matters.',
    );
  }
  const { getDocumentProxy } = await import('unpdf');
  const pdf = await getDocumentProxy(readable);
  try {
    if (pdf.numPages > PDF_MAX_PAGES) {
      throw new UnreadableDocument(
        `That PDF has ${pdf.numPages.toLocaleString('en-US')} pages, and Tesserafy reads up to ${PDF_MAX_PAGES.toLocaleString('en-US')}. Split it, or paste the part that matters.`,
      );
    }
    const started = Date.now();
    const pages: string[] = [];
    for (let number = 1; number <= pdf.numPages; number++) {
      if (Date.now() - started > PDF_READ_MS) {
        throw new UnreadableDocument('That PDF took too long to read. Split it, or paste the part that matters.');
      }
      const page = await pdf.getPage(number);
      const { items } = await page.getTextContent();
      pages.push(items.map((item) => ('str' in item ? item.str + (item.hasEOL ? '\n' : '') : '')).join(''));
      page.cleanup();
    }
    return pages.join('\n').replace(/[^\S\n]+/g, ' ').replace(/ ?\n ?/g, '\n').replace(/\n{3,}/g, '\n\n');
  } finally {
    await pdf.loadingTask.destroy();
  }
}

/** The plain text of an uploaded file, or UnreadableDocument saying why not. */
export async function documentText(fileName: string, bytes: ArrayBuffer): Promise<string> {
  const name = fileName.toLowerCase();
  let text: string;
  if (name.endsWith('.pdf')) {
    text = await pdfText(new Uint8Array(bytes));
  } else if (name.endsWith('.docx')) {
    if (!docxFitsIn(new Uint8Array(bytes))) {
      throw new UnreadableDocument('That Word file could not be read safely. Save it again, or paste the part that matters.');
    }
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
