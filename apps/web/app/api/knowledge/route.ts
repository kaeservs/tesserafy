import { NextResponse, type NextRequest } from 'next/server';
import { myCompanyId } from '@/lib/company';
import { addDocument, documentText, UnreadableDocument, UPLOAD_MAX_BYTES } from '@/lib/knowledge';
import { allowance, tooMany } from '@/lib/rate-limit';
import { caller } from '@/lib/supabase/caller';

/**
 * POST /api/knowledge — add a document to the company's knowledge: a file
 * (PDF, Word, text, Markdown) or pasted text, with a title. Owners only; the
 * database says so (create_knowledge_document). Read, split, embedded inside
 * Supabase and stored before this answers (lib/knowledge).
 *
 * Not charged to the plan: no model is called, and embedding runs inside
 * Supabase. Rate limited, because it does run.
 */
export const runtime = 'nodejs';
export const maxDuration = 120;

export async function POST(request: NextRequest) {
  const who = await caller(request);
  if (!who) return NextResponse.json({ error: 'not signed in' }, { status: 401 });
  const token = await who.token();
  const companyId = await myCompanyId(who.db, who.userId);
  if (!token || !companyId) return NextResponse.json({ error: 'not a member of a company' }, { status: 403 });

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: 'send the document as a form' }, { status: 400 });
  }
  const file = form.get('file');
  const pasted = form.get('text');
  const rawTitle = form.get('title');
  let title = typeof rawTitle === 'string' ? rawTitle.trim() : '';

  const limit = await allowance(who.db, 'api/knowledge');
  if (!limit.allowed) return tooMany('api/knowledge', limit.retryAfterSeconds);

  let text: string;
  let source: 'upload' | 'pasted';
  let fileName: string | null = null;
  if (file instanceof File && file.size > 0) {
    if (file.size > UPLOAD_MAX_BYTES) {
      return NextResponse.json({ error: 'A file is up to 4 MB. Split a larger one, or paste the part that matters.' }, { status: 413 });
    }
    source = 'upload';
    fileName = file.name.slice(0, 255);
    title ||= file.name.replace(/\.[a-z0-9]+$/i, '').slice(0, 200);
    try {
      text = await documentText(file.name, await file.arrayBuffer());
    } catch (cause) {
      const message = cause instanceof UnreadableDocument ? cause.message : 'That file could not be read.';
      return NextResponse.json({ error: message }, { status: 422 });
    }
  } else if (typeof pasted === 'string' && pasted.trim().length >= 20) {
    source = 'pasted';
    text = pasted.trim();
  } else {
    return NextResponse.json({ error: 'Choose a file, or paste at least a sentence.' }, { status: 400 });
  }
  if (!title) return NextResponse.json({ error: 'Give it a title.' }, { status: 400 });

  const outcome = await addDocument(who.db, token, companyId, { title, source, fileName, text });
  if (outcome.status === 'failed') {
    return NextResponse.json({ error: outcome.message, documentId: outcome.documentId }, { status: outcome.documentId ? 422 : 403 });
  }
  return NextResponse.json(outcome);
}
