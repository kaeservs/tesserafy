import Anthropic from '@anthropic-ai/sdk';
import { assist, ASSIST_MODES, databaseSink, recordFailure, T2_ASSISTER, type AssistMode, type SuggestableSegment } from '@tesserafy/ai';
import { NextResponse, type NextRequest } from 'next/server';
import { myCompanyId } from '@/lib/company';
import { purposeOf } from '@/lib/guidance';
import { LIVE_LIMITS, liveAllowedFor, liveTranscript } from '@/lib/live-input';
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

  if (!(await liveAllowedFor(who.db, who.userId))) {
    return NextResponse.json({ error: 'Live is not on your plan.' }, { status: 403 });
  }
  const limit = await allowance(who.db, 'api/assist');
  if (!limit.allowed) return tooMany('api/assist', limit.retryAfterSeconds);
  const { data: live } = await who.db.rpc('plan_has_allowance', { p_meter: 'live_seconds' });
  if (live !== true) {
    return NextResponse.json({ error: 'Your plan has no live minutes left this month.' }, { status: 402 });
  }

  // The prep for this call, read as the person (RLS), as the brief it gives.
  let brief: string | null = null;
  if (typeof body.prepId === 'string' && /^[0-9a-f-]{36}$/i.test(body.prepId)) {
    const { data: prep } = await who.db.from('call_preps').select(PREP_COLUMNS).eq('id', body.prepId).returns<PrepRow[]>().maybeSingle();
    if (prep) {
      const { data: account } = prep.account_id
        ? await who.db.from('accounts').select('name').eq('id', prep.account_id).maybeSingle()
        : { data: null };
      brief = briefText(prep, account?.name ?? null);
    }
  }
  const companyId = await myCompanyId(who.db, who.userId);
  const engagementType = typeof body.engagementType === 'string' ? body.engagementType.slice(0, 64) : 'discovery';
  const purpose = companyId ? await purposeOf(who.db, companyId, engagementType) : null;

  try {
    const result = await assist(
      { mode, ...(mode === 'ask' ? { question } : {}), transcript, criteria, brief },
      {
        client: new Anthropic(),
        guidance: { instructions: [], examples: [], purpose },
        onUsage: databaseSink({ db: who.db, detector: T2_ASSISTER }),
      },
    );
    return NextResponse.json({ mode, points: result.points, dropped: result.dropped });
  } catch (error) {
    const failure = recordFailure(error, { db: who.db, source: 'api/assist', tier: 't2' });
    return NextResponse.json({ error: failure.message }, { status: 502 });
  }
}
