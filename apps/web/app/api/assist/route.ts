import Anthropic from '@anthropic-ai/sdk';
import {
  assist,
  ASSIST_MODES,
  databaseSink,
  recordFailure,
  T2_ASSISTER,
  type AssistMode,
  type KnowledgePassage,
  type SuggestableSegment,
} from '@tesserafy/ai';
import { NextResponse, type NextRequest } from 'next/server';
import { myCompanyId } from '@/lib/company';
import { purposeOf } from '@/lib/guidance';
import { LIVE_LIMITS, liveAllowedFor, liveTranscript, readScreen } from '@/lib/live-input';
import { hasKnowledge, knowledgeFor } from '@/lib/knowledge';
import { briefText } from '@/lib/live-setup';
import { PREP_COLUMNS, type PrepRow } from '@/lib/prep';
import { allowance, tooMany } from '@/lib/rate-limit';
import { caller } from '@/lib/supabase/caller';

/**
 * POST /api/assist — the overlay's four buttons and ask box (T2, t2-assist):
 * Assist, What should I say?, Follow-up questions, Recap, or a typed
 * question, over the call so far and the prep for it.
 *
 * Like /api/suggest: live only (the plan says so, here as well as in the
 * pages), rate limited, and run only while the plan has live time left; the
 * detections of the call are what spend it. Every point about the call
 * quotes it, or is dropped.
 */
export const runtime = 'nodejs';
export const preferredRegion = 'iad1';

interface AssistBody {
  mode?: unknown;
  question?: unknown;
  transcript?: unknown;
  criteria?: unknown;
  prepId?: unknown;
  engagementType?: unknown;
  screen?: unknown;
}


export async function POST(request: NextRequest) {
  const who = await caller(request);
  if (!who) return NextResponse.json({ error: 'not signed in' }, { status: 401 });
  if (!process.env['ANTHROPIC_API_KEY']) {
    return NextResponse.json({ error: 'ANTHROPIC_API_KEY is not set' }, { status: 503 });
  }

  let body: AssistBody;
  try {
    body = (await request.json()) as AssistBody;
  } catch {
    return NextResponse.json({ error: 'body must be JSON' }, { status: 400 });
  }
  const mode: AssistMode | undefined = ASSIST_MODES.find((known) => known === body.mode);
  if (!mode) return NextResponse.json({ error: 'mode is one of assist, say, followups, recap, ask' }, { status: 400 });
  const question = typeof body.question === 'string' ? body.question.trim() : '';
  if (mode === 'ask' && (question.length === 0 || question.length > 500)) {
    return NextResponse.json({ error: 'a question is 1 to 500 characters' }, { status: 400 });
  }
  // Bounded and redacted before any of it reaches a model (lib/live-input).
  const transcript = liveTranscript<SuggestableSegment>(body.transcript ?? []);
  if (!transcript) return NextResponse.json({ error: 'transcript must be the call so far' }, { status: 400 });
  const criteria = Array.isArray(body.criteria)
    ? (body.criteria as { key?: unknown; label?: unknown; status?: unknown }[])
        .slice(0, LIVE_LIMITS.criteria)
        .flatMap((c) =>
          typeof c.key === 'string' && typeof c.label === 'string' && typeof c.status === 'string'
            ? [{ key: c.key.slice(0, 64), label: c.label.slice(0, 80), status: c.status.slice(0, 20) }]
            : [],
        )
    : [];

  const screen = readScreen(body.screen);
  if (screen === 'invalid') return NextResponse.json({ error: 'the screenshot must be a JPEG or PNG under 1.5 MB' }, { status: 400 });

  // The gates, side by side rather than one after another: each is a round
  // trip to the database, and the seller is waiting on the answer. All must
  // pass; the order they are reported in is the order they were written in.
  const [liveAllowed, limit, { data: live }, companyId] = await Promise.all([
    liveAllowedFor(who.db, who.userId),
    allowance(who.db, 'api/assist'),
    who.db.rpc('plan_has_allowance', { p_meter: 'live_seconds' }),
    myCompanyId(who.db, who.userId),
  ]);
  if (!liveAllowed) return NextResponse.json({ error: 'Live is not on your plan.' }, { status: 403 });
  if (!limit.allowed) return tooMany('api/assist', limit.retryAfterSeconds);
  if (live !== true) {
    return NextResponse.json({ error: 'Your plan has no live minutes left this month.' }, { status: 402 });
  }

  // Three lookups, side by side for the same reason.
  if (screen && companyId) {
    const { data: company } = await who.db.from('companies').select('screen_assist').eq('id', companyId).maybeSingle();
    if (company?.screen_assist !== true) {
      return NextResponse.json({ error: 'Your company has switched off Ask about your screen.' }, { status: 403 });
    }
  }
  const engagementType = typeof body.engagementType === 'string' ? body.engagementType.slice(0, 64) : 'discovery';
  const lookFor = mode === 'ask' ? question : transcript.slice(-3).map((segment) => segment.text).join(' ');
  const [brief, purpose, knowledge] = await Promise.all([
    // The prep for this call, read as the person (RLS), as the brief it gives.
    (async (): Promise<string | null> => {
      if (typeof body.prepId !== 'string' || !/^[0-9a-f-]{36}$/i.test(body.prepId)) return null;
      const { data: prep } = await who.db.from('call_preps').select(PREP_COLUMNS).eq('id', body.prepId).returns<PrepRow[]>().maybeSingle();
      if (!prep) return null;
      const { data: account } = prep.account_id
        ? await who.db.from('accounts').select('name').eq('id', prep.account_id).maybeSingle()
        : { data: null };
      return briefText(prep, account?.name ?? null);
    })(),
    companyId ? purposeOf(who.db, companyId, engagementType) : Promise.resolve(null),
    // The company's own documents that fit this moment: the question typed, or
    // what was just said. Only when there are any, so a company with none pays
    // no search; and a search that fails leaves the answer without, never
    // without an answer.
    (async (): Promise<KnowledgePassage[]> => {
      if (!companyId || !lookFor || !(await hasKnowledge(who.db, companyId))) return [];
      const token = await who.token();
      try {
        return token ? await knowledgeFor(who.db, token, companyId, lookFor, 4) : [];
      } catch (error) {
        recordFailure(error, { db: who.db, source: 'api/assist/knowledge' });
        return [];
      }
    })(),
  ]);

  const input = { mode, ...(mode === 'ask' ? { question } : {}), transcript, criteria, brief, knowledge, screen };
  const options = {
    client: new Anthropic(),
    guidance: { instructions: [], examples: [], purpose },
    onUsage: databaseSink({ db: who.db, detector: T2_ASSISTER }),
  };

  // Streamed, when the caller asks for it (the overlay from 0.1.11): one line
  // per point as soon as its quote is found, then one saying it is done. The
  // first point shows a second or two before the last is written. Anything
  // else — an older overlay — gets the whole answer at once, as before.
  if ((request.headers.get('accept') ?? '').includes('application/x-ndjson')) {
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (line: unknown) => controller.enqueue(encoder.encode(`${JSON.stringify(line)}\n`));
        try {
          // The screenshot goes to the model for this answer and nowhere else.
          const result = await assist(input, options, (point) => send({ type: 'point', point }));
          send({ type: 'done', mode, points: result.points, dropped: result.dropped });
        } catch (error) {
          const failure = recordFailure(error, { db: who.db, source: 'api/assist', tier: 't2' });
          send({ type: 'error', error: failure.message });
        }
        controller.close();
      },
    });
    return new Response(body, { headers: { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store' } });
  }

  try {
    // The screenshot goes to the model for this answer and nowhere else.
    const result = await assist(input, options);
    return NextResponse.json({ mode, points: result.points, dropped: result.dropped });
  } catch (error) {
    const failure = recordFailure(error, { db: who.db, source: 'api/assist', tier: 't2' });
    return NextResponse.json({ error: failure.message }, { status: 502 });
  }
}
