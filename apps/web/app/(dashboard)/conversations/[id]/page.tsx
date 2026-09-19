import Link from 'next/link';
import { notFound } from 'next/navigation';
import { clock, splitByHighlights } from '@/lib/highlight';
import { createClient } from '@/lib/supabase/server';

/**
 * One conversation: what was said, and what was extracted from it.
 *
 * The P1 gate lives here — every signal links to a timestamped quote, and
 * following that link scrolls to the segment and highlights the phrase.
 *
 * No company filter in any of these queries, on purpose. They run as the
 * signed-in user, so RLS decides what comes back. A conversation belonging to
 * another tenant is simply not found.
 */

interface SegmentRow {
  id: string;
  speaker: string | null;
  start_ms: number;
  text: string;
}

interface SignalRow {
  id: string;
  kind: string;
  summary: string;
  confidence: number;
}

interface EvidenceRow {
  signal_id: string;
  segment_id: string;
  quote: string;
  quote_start: number;
  quote_end: number;
}

const KIND_LABEL: Record<string, string> = {
  problem: 'Problem',
  feature_request: 'Feature request',
};

export default async function ConversationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: conversation } = await supabase
    .from('conversations')
    .select('id, title, occurred_at')
    .eq('id', id)
    .maybeSingle();

  if (!conversation) notFound();

  const [segmentsResult, signalsResult, evidenceResult] = await Promise.all([
    supabase.from('segments').select('id, speaker, start_ms, text').eq('conversation_id', id).order('start_ms'),
    supabase.from('signals').select('id, kind, summary, confidence').eq('conversation_id', id),
    // Evidence is fetched separately rather than embedded: signal_evidence
    // reaches signals through a composite (company_id, signal_id) key, which
    // PostgREST cannot resolve into an embed.
    supabase.from('signal_evidence').select('signal_id, segment_id, quote, quote_start, quote_end'),
  ]);

  const failure = segmentsResult.error ?? signalsResult.error ?? evidenceResult.error;
  if (failure) throw new Error(`Could not load the conversation: ${failure.message}`);

  const segments = (segmentsResult.data ?? []) as SegmentRow[];
  const signals = (signalsResult.data ?? []) as SignalRow[];
  const signalIds = new Set(signals.map((signal) => signal.id));
  const evidence = ((evidenceResult.data ?? []) as EvidenceRow[]).filter((row) =>
    signalIds.has(row.signal_id),
  );

  const evidenceBySignal = new Map<string, EvidenceRow[]>();
  const rangesBySegment = new Map<string, { start: number; end: number }[]>();
  for (const row of evidence) {
    evidenceBySignal.set(row.signal_id, [...(evidenceBySignal.get(row.signal_id) ?? []), row]);
    rangesBySegment.set(row.segment_id, [
      ...(rangesBySegment.get(row.segment_id) ?? []),
      { start: row.quote_start, end: row.quote_end },
    ]);
  }

  const startedAt = new Map(segments.map((segment) => [segment.id, segment.start_ms]));
  const { title, occurred_at: occurredAt } = conversation as {
    title: string;
    occurred_at: string | null;
  };

  return (
    <main>
      <p>
        <Link href="/conversations">← Conversations</Link>
      </p>
      <h1>{title}</h1>
      <p className="muted">
        <Link href={`/live/${id}`}>Replay as a live scorecard →</Link>
      </p>
      <p className="muted">
        {occurredAt ? new Date(occurredAt).toLocaleDateString('en-GB') : 'Date unknown'} ·{' '}
        {segments.length} segments · {signals.length} signals
      </p>

      <section aria-labelledby="signals-heading">
        <h2 id="signals-heading">Signals</h2>
        {signals.length === 0 ? (
          <p className="muted">
            Nothing extracted yet. Run <code>pnpm ingest</code> against this transcript, or the
            extractor found nothing it could evidence.
          </p>
        ) : (
          <ul className="signals">
            {signals.map((signal) => (
              <li key={signal.id} className="signal">
                <div className="signal-kind muted">{KIND_LABEL[signal.kind] ?? signal.kind}</div>
                <div>{signal.summary}</div>
                <ul className="evidence">
                  {(evidenceBySignal.get(signal.id) ?? []).map((item) => (
                    <li key={`${item.signal_id}-${item.segment_id}-${item.quote_start}`}>
                      {/* The whole point of the gate: the claim is a link to
                          the words it came from. */}
                      <a href={`#segment-${item.segment_id}`}>
                        “{item.quote}” <span className="muted">at {clock(startedAt.get(item.segment_id) ?? 0)}</span>
                      </a>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="transcript-heading">
        <h2 id="transcript-heading">Transcript</h2>
        {segments.length === 0 ? (
          <p className="muted">This conversation has no segments.</p>
        ) : (
          <ol className="transcript">
            {segments.map((segment) => (
              <li key={segment.id} id={`segment-${segment.id}`} className="segment">
                <div className="muted segment-meta">
                  {clock(segment.start_ms)} · {segment.speaker ?? 'unknown'}
                </div>
                <p>
                  {splitByHighlights(segment.text, rangesBySegment.get(segment.id) ?? []).map(
                    (piece, index) =>
                      piece.highlighted ? (
                        <mark key={index}>{piece.text}</mark>
                      ) : (
                        <span key={index}>{piece.text}</span>
                      ),
                  )}
                </p>
              </li>
            ))}
          </ol>
        )}
      </section>
    </main>
  );
}
