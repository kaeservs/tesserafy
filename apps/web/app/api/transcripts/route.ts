import {
  anyRedactions,
  parseTurns,
  parseVtt,
  redactSegments,
  toSegments,
  TranscriptParseError,
} from '@tesserafy/ingest';
import { recordFailure } from '@tesserafy/ai';
import { after, NextResponse, type NextRequest } from 'next/server';
import { CONSENT_REQUIRED, CONSENT_STATEMENTS, consentConfirmed } from '@/lib/consent';
import { allowance, tooMany } from '@/lib/rate-limit';
import { embedUploadedConversation } from '@/lib/embed-upload';
import { scoreUploadedConversation } from '@/lib/score-upload';
import { caller } from '@/lib/supabase/caller';

/**
 * Importing a transcript, from a browser.
 *
 * The MVP is post-call, and everything downstream of the import has worked
 * for a while. The import itself was `pnpm ingest` — a terminal, a
 * service-role key and a local embedding model — so a person could read
 * everything in this product and add nothing to it.
 *
 * Parsing happens here rather than in the page. It is T0, pure TypeScript and
 * the same `@tesserafy/ingest` the operator script uses, so a file imported
 * through the web chunks into exactly the segments it would have chunked into
 * through the terminal. Two parsers would mean two answers to "where does a
 * segment begin", and every quote offset in the product hangs off that.
 *
 * No embeddings, deliberately. The embedder is a model on an operator's
 * machine that a web request cannot reach, and a conversation with segments
 * and no vectors is a state the product already understands — the pipeline
 * column reads "captured" until `pnpm process` runs. The alternative, making
 * the import wait for something the browser cannot do, would be no import at
 * all.
 *
 * Scoring, on the other hand, now happens here. It runs after the response,
 * so the person is taken to their conversation at once and the scorecard
 * arrives behind them. See lib/score-upload.ts for why it is safe to run
 * without a person asking, and why extraction still is not.
 */
export const runtime = 'nodejs';

/**
 * The scoring pass runs inside this function after it has responded, and the
 * largest call it will take on is sized to finish in about 190 s at p90.
 */
export const maxDuration = 300;

/** Comfortably above a long call, well below anything that should be a file. */
const MAX_BYTES = 2_000_000;

export async function POST(request: NextRequest) {
  const who = await caller(request);
  if (!who) {
    return NextResponse.json({ error: 'not signed in' }, { status: 401 });
  }

  // Before the file is even read. Each upload now spends model calls on its
  // own — up to about $0.95 for the longest call scored automatically — so the
  // number of uploads is what bounds what one account can cost.
  const limit = await allowance(who.db, 'api/transcripts');
  if (!limit.allowed) return tooMany('api/transcripts', limit.retryAfterSeconds);

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: 'expected a file upload' }, { status: 400 });
  }

  // Before the file is read: a call nobody confirmed consent for is not
  // one this product keeps, however well it parses.
  if (!consentConfirmed(form.get('consent'))) {
    return NextResponse.json({ error: CONSENT_REQUIRED }, { status: 400 });
  }

  const file = form.get('transcript');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'no transcript file' }, { status: 400 });
  }
  if (file.size === 0) {
    return NextResponse.json({ error: 'that file is empty' }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `that file is ${Math.round(file.size / 1000)} kB; the limit is 2000 kB` },
      { status: 413 },
    );
  }

  const source = await file.text();
  const json = file.name.toLowerCase().endsWith('.json');

  let segments;
  let parsedTitle: string | null;
  try {
    const parsed = json ? parseTurns(JSON.parse(source)) : parseVtt(source);
    parsedTitle = parsed.title;
    segments = toSegments(parsed.turns);
  } catch (cause) {
    // A parse failure names where it failed, which is the difference between
    // "fix line 40" and "try a different file".
    const detail =
      cause instanceof TranscriptParseError || cause instanceof Error
        ? cause.message
        : 'could not be read';
    return NextResponse.json({ error: `That transcript ${detail}` }, { status: 422 });
  }

  if (segments.length === 0) {
    return NextResponse.json({ error: 'That transcript has nothing in it' }, { status: 422 });
  }

  // The title the person typed, then the one the file carries, then its
  // name. A WebVTT header often names the meeting better than the filename
  // a conferencing tool generated.
  const title =
    (form.get('title') as string | null)?.trim() ||
    parsedTitle?.trim() ||
    file.name.replace(/\.[^.]+$/, '');
  const occurredAt = (form.get('occurredAt') as string | null)?.trim() || null;
  const engagementType = (form.get('engagementType') as string | null)?.trim() || 'discovery';
  const criteriaVersion = Number(form.get('criteriaVersion') ?? 1);

  // Before anything is written. An identifier that reaches the database has
  // reached the embeddings, the prompts, the ticket bodies and the backups
  // with it; this is the one place where removing it removes it everywhere.
  const { segments: clean, counts } = redactSegments(segments);

  const { data, error } = await who.db.rpc('import_conversation', {
    p_title: title,
    p_segments: clean.map((segment) => ({
      speaker: segment.speaker,
      startMs: segment.startMs,
      endMs: segment.endMs,
      text: segment.text,
    })),
    ...(occurredAt ? { p_occurred_at: new Date(occurredAt).toISOString() } : {}),
    p_engagement_type: engagementType,
    p_criteria_version: Number.isInteger(criteriaVersion) ? criteriaVersion : 1,
    // The words, chosen here rather than sent by the browser, so what is
    // stored is what the form showed. Who and when are taken by the database.
    p_consent_statement: CONSENT_STATEMENTS.imported,
    // No company named: the function resolves the caller's own. A browser has
    // no business choosing which tenant a transcript lands in.
  });

  if (error) {
    const status = error.code === '42501' ? 403 : error.code === '22023' ? 400 : 502;
    // A refusal we designed — not a member, or a malformed argument — is an
    // answer, and answers are not failures. A constraint or a missing function
    // is a failure, and classify() already tells them apart by SQLSTATE, so
    // only the ones we did not plan for are recorded.
    if (status === 502) recordFailure(error, { db: who.db, source: 'api/transcripts' });
    return NextResponse.json({ error: error.message }, { status });
  }

  const conversationId = data;

  // The caller's own token, for the embedding function. Read before
  // responding, while the request and its cookies are certainly still here.
  const accessToken =
    request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ??
    (await who.db.auth.getSession()).data.session?.access_token ??
    null;

  // After the response, as the same person: scoring and embedding side by
  // side, neither waiting on the other. A failure in either cannot reach them
  // — they are already looking at their conversation — so it goes where
  // failures go, and the page keeps saying what has not happened rather than
  // pretending it did.
  after(async () => {
    await Promise.all([
      process.env['ANTHROPIC_API_KEY']
        ? scoreUploadedConversation(who.db, conversationId).catch((cause: unknown) => {
            recordFailure(cause, {
              db: who.db,
              source: 'api/transcripts/score',
              tier: 't1',
              conversationId,
            });
          })
        : Promise.resolve(),
      accessToken
        ? embedUploadedConversation(who.db, conversationId, accessToken).catch((cause: unknown) => {
            recordFailure(cause, {
              db: who.db,
              source: 'api/transcripts/embed',
              conversationId,
            });
          })
        : Promise.resolve(),
    ]);
  });

  return NextResponse.json({
    conversationId,
    segments: clean.length,
    // Reported rather than silent: somebody uploading a transcript should
    // learn that it carried a phone number, not discover it later.
    ...(anyRedactions(counts) ? { redacted: counts } : {}),
  });
}
