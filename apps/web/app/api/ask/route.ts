import Anthropic from '@anthropic-ai/sdk';
import {
  ASK_CALLS_AGENT,
  askCalls,
  companySources,
  createSupabaseEmbedder,
  databaseSink,
  QUESTION_MAX_CHARS,
  recordFailure,
  toCompanyId,
  TracingEnabled,
  UnreadableAnswer,
} from '@tesserafy/ai';
import { NextResponse, type NextRequest } from 'next/server';
import { askFilters, askScope, shown, type AskFilters } from '@/lib/ask';
import { myCompanyId } from '@/lib/company';
import { publicSupabaseEnv } from '@/lib/env';
import { planExhausted, refund, spend } from '@/lib/plan';
import { allowance, tooMany } from '@/lib/rate-limit';
import { caller } from '@/lib/supabase/caller';

/**
 * POST /api/ask — "Ask your calls" (ADR 0018).
 *
 * A question, answered by the agent in packages/ai from the company's calls
 * and documents, read as the person asking. Answered as it works: one line
 * of NDJSON per step ("Searching your calls for …"), then the answer, whose
 * every point quotes a call or a document and links to it.
 *
 * Rate limited, then charged one question from the plan; refunded when no
 * answer comes back. Nothing is stored but the model usage.
 */
export const runtime = 'nodejs';
export const preferredRegion = 'iad1';
export const maxDuration = 60;

/** Under maxDuration, so the route can still say what happened. */
const TIME_LIMIT_MS = 50_000;

export async function POST(request: NextRequest) {
  const who = await caller(request);
  if (!who) return NextResponse.json({ error: 'not signed in' }, { status: 401 });
  if (!process.env['ANTHROPIC_API_KEY']) {
    return NextResponse.json({ error: 'Ask is not configured on this deployment.' }, { status: 503 });
  }

  let question: string;
  let filters: AskFilters;
  try {
    const body = (await request.json()) as { question?: unknown; accountId?: unknown; days?: unknown };
    question = typeof body.question === 'string' ? body.question.trim() : '';
    filters = askFilters(body);
  } catch {
    return NextResponse.json({ error: 'body must be JSON' }, { status: 400 });
  }
  if (question.length < 3 || question.length > QUESTION_MAX_CHARS) {
    return NextResponse.json({ error: `A question is 3 to ${QUESTION_MAX_CHARS} characters.` }, { status: 400 });
  }

  const companyId = await myCompanyId(who.db, who.userId);
  const token = await who.token();
  if (!companyId || !token) return NextResponse.json({ error: 'Ask needs a company to search.' }, { status: 409 });

  // Narrowed to one account's calls, or the last so many days: worked out
  // before anything is charged, so a scope with no calls in it costs nothing.
  let scope: Awaited<ReturnType<typeof askScope>>;
  try {
    scope = await askScope(who.db, filters);
  } catch (error) {
    const failure = recordFailure(error, { db: who.db, source: 'api/ask/scope', companyId });
    return NextResponse.json({ error: failure.message }, { status: 502 });
  }
  if (scope && scope.conversationIds.length === 0) {
    return NextResponse.json({ error: `There are no ${scope.text} to search.` }, { status: 422 });
  }

  const limit = await allowance(who.db, 'api/ask');
  if (!limit.allowed) return tooMany('api/ask', limit.retryAfterSeconds);
  const spent = await spend(who.db, 'questions');
  if (!spent.allowed) return planExhausted(spent);

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (line: object) => controller.enqueue(encoder.encode(`${JSON.stringify(line)}\n`));
      try {
        const answer = await askCalls(question, {
          client: new Anthropic(),
          sources: companySources(
            who.db,
            toCompanyId(companyId),
            createSupabaseEmbedder({ url: publicSupabaseEnv().url, token }),
            scope ? { conversationIds: scope.conversationIds } : {},
          ),
          ...(scope ? { scope: scope.text } : {}),
          onUsage: databaseSink({ db: who.db, companyId, detector: ASK_CALLS_AGENT }),
          onStep: (text) => send({ type: 'step', text }),
          signal: AbortSignal.timeout(TIME_LIMIT_MS),
        });
        send({ type: 'answer', points: answer.points.map(shown), note: answer.note, dropped: answer.dropped, rounds: answer.rounds });
      } catch (error) {
        await refund(who.db, spent);
        const failure = recordFailure(error, { db: who.db, source: 'api/ask', tier: 't3', companyId });
        const message =
          error instanceof TracingEnabled
            ? 'Ask is switched off on this deployment.'
            : error instanceof UnreadableAnswer
              ? 'The answer came back garbled, so nothing was shown. Ask again; it was not charged.'
              : error instanceof Error && error.name === 'TimeoutError'
              ? 'That took too long to answer. Try a narrower question.'
              : failure.message;
        send({ type: 'error', error: message });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { 'content-type': 'application/x-ndjson', 'cache-control': 'no-store' } });
}
