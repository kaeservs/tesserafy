import Link from 'next/link';
import { notFound } from 'next/navigation';
import { clock } from '@/lib/highlight';
import { createClient } from '@/lib/supabase/server';
import { Decide } from './decide';

/**
 * One insight, and every quote it rests on.
 *
 * This is the P5 gate made visible: at least three evidence items from at
 * least two conversations, each naming the customer and the time it was said,
 * and each a link back to the words in the transcript.
 *
 * The chain is insight -> signal -> signal_evidence -> segment -> conversation,
 * fetched as separate queries rather than PostgREST embeds: every hop here
 * crosses a composite (company_id, id) key, which embeds cannot resolve.
 */

interface SignalRow {
  id: string;
  conversation_id: string;
  kind: string;
  summary: string;
}

interface EvidenceRow {
  signal_id: string;
  segment_id: string;
  quote: string;
}

const KIND_LABEL: Record<string, string> = {
  problem: 'Problem',
  feature_request: 'Feature request',
};

const STATUS_LABEL: Record<string, string> = {
  proposed: 'Proposed — waiting for your decision',
  approved: 'Approved',
  dismissed: 'Dismissed',
};

export default async function InsightPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: insight } = await supabase
    .from('insights')
    .select('id, title, summary, created_at, status')
    .eq('id', id)
    .maybeSingle();

  if (!insight) notFound();

  const { data: ticket } = await supabase
    .from('insight_tickets')
    .select('url')
    .eq('insight_id', id)
    .maybeSingle();

  const { data: citations, error: citationsError } = await supabase
    .from('insight_evidence')
    .select('signal_id')
    .eq('insight_id', id);
  if (citationsError) throw new Error(`Could not load citations: ${citationsError.message}`);

  const signalIds = ((citations ?? [])).map((row) => row.signal_id);

  const [signalsResult, evidenceResult] = await Promise.all([
    supabase.from('signals').select('id, conversation_id, kind, summary').in('id', signalIds),
    supabase.from('signal_evidence').select('signal_id, segment_id, quote').in('signal_id', signalIds),
  ]);

  const failure = signalsResult.error ?? evidenceResult.error;
  if (failure) throw new Error(`Could not load evidence: ${failure.message}`);

  const signals = (signalsResult.data ?? []) as SignalRow[];
  const evidence = (evidenceResult.data ?? []) as EvidenceRow[];

  const conversationIds = [...new Set(signals.map((signal) => signal.conversation_id))];
  const segmentIds = [...new Set(evidence.map((row) => row.segment_id))];

  const [conversationsResult, segmentsResult] = await Promise.all([
    supabase.from('conversations').select('id, title, occurred_at').in('id', conversationIds),
    supabase.from('segments').select('id, start_ms, speaker').in('id', segmentIds),
  ]);

  const conversations = new Map(
    ((conversationsResult.data ?? [])).map(
      (row) => [row.id, row],
    ),
  );
  const segments = new Map(
    ((segmentsResult.data ?? [])).map(
      (row) => [row.id, row],
    ),
  );

  const { title, summary, status } = insight as {
    title: string;
    summary: string;
    status: string;
  };

  return (
    <main>
      <p>
        <Link href="/insights">← Insights</Link>
      </p>
      <h1>{title}</h1>
      <p>{summary}</p>
      <p className="muted">
        {signals.length} signals across {conversationIds.length} meetings ·{' '}
        {STATUS_LABEL[status] ?? status}
      </p>

      <Decide
        insightId={id}
        status={status}
        ticketUrl={(ticket)?.url ?? null}
      />

      <section aria-labelledby="evidence-heading">
        <h2 id="evidence-heading">Evidence</h2>
        <ul className="signals">
          {signals.map((signal) => {
            const conversation = conversations.get(signal.conversation_id);
            const quotes = evidence.filter((row) => row.signal_id === signal.id);

            return (
              <li key={signal.id} className="signal">
                <div className="signal-kind muted">{KIND_LABEL[signal.kind] ?? signal.kind}</div>
                <div>{signal.summary}</div>
                <ul className="evidence">
                  {quotes.map((quote) => {
                    const segment = segments.get(quote.segment_id);
                    return (
                      <li key={`${quote.signal_id}-${quote.segment_id}`}>
                        {/* Customer, timestamp, and a link to the words: the
                            three things the gate asks every citation to carry. */}
                        <a
                          href={`/conversations/${signal.conversation_id}#segment-${quote.segment_id}`}
                        >
                          “{quote.quote}”
                        </a>{' '}
                        <span className="muted">
                          — {conversation?.title ?? 'unknown conversation'}
                          {segment ? `, ${clock(segment.start_ms)}` : ''}
                          {segment?.speaker ? `, ${segment.speaker}` : ''}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </li>
            );
          })}
        </ul>
      </section>
    </main>
  );
}
