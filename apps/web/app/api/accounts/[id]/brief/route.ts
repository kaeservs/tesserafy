import { NextResponse, type NextRequest } from 'next/server';
import { fetchCriterionLabels } from '@tesserafy/db';
import { accountBrief } from '@/lib/accounts';
import { pickPrep, PREP_COLUMNS, readBrief, type PrepRow } from '@/lib/prep';
import { caller } from '@/lib/supabase/caller';

/**
 * The pre-call brief the overlay shows: where the deal stands, the last call,
 * and the few things the customer said that a seller should walk in knowing —
 * each with the words they used. Small on purpose: it is read in the minute
 * before a call, on a card the size of a scorecard.
 */
export const runtime = 'nodejs';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const who = await caller(request);
  if (!who) return NextResponse.json({ error: 'not signed in' }, { status: 401 });

  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'not found' }, { status: 404 });
  const brief = await accountBrief(who.db, id);
  if (!brief) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const last = brief.calls[0] ?? null;

  // The prep for the call about to happen, if someone wrote one: what to open
  // with and what to ask, each question naming the criterion it is after so the
  // overlay can tick it off when the scorecard confirms it.
  const { data: preps } = await who.db.from('call_preps').select(PREP_COLUMNS).eq('account_id', id).returns<PrepRow[]>();
  const prep = pickPrep(preps ?? [], new Date());
  const prepBrief = prep ? readBrief(prep.brief) : null;
  const labels = prep && prepBrief ? await fetchCriterionLabels(who.db, prep.company_id) : [];
  const labelOf = new Map(labels.filter((label) => label.engagementType === prep?.engagement_type).map((label) => [label.key, label.label]));
  return NextResponse.json({
    name: brief.account.name,
    calls: brief.calls.length,
    outcome: brief.account.latestOutcome,
    last: last
      ? { title: last.title, date: last.date, score: last.score === null ? null : Math.round(last.score) }
      : null,
    said: brief.signals.slice(0, 4).map((signal) => ({ kind: signal.kind, summary: signal.summary, quote: signal.quote })),
    notes: brief.notes.slice(0, 2).map((note) => note.body),
    prep:
      prep && prepBrief
        ? {
            person: prep.person_name,
            callAt: prep.call_at,
            openWith: prepBrief.openWith,
            questions: prepBrief.questions.slice(0, 4).map((question) => ({
              key: question.criterionKey,
              label: labelOf.get(question.criterionKey) ?? question.criterionKey,
              ask: question.ask,
            })),
          }
        : null,
  });
}
