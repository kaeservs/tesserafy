import Link from 'next/link';
import { notFound } from 'next/navigation';
import { clock, splitByHighlights } from '@/lib/highlight';
import { conversationPipeline, nextCommand, stageOf } from '@/lib/pipeline';
import { scoreConversation, type ScorableConversation } from '@/lib/scorecard';
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
    .select('id, title, occurred_at, engagement_type, criteria_version')
    .eq('id', id)
    .maybeSingle();

  if (!conversation) notFound();

  // Computed on read from the quoted spans in criterion_events, by the same
  // two pure functions the live overlay runs. Nothing stored is a score
  // (invariant 1), so this page and a call happening right now cannot
  // disagree about what the evidence adds up to.
  const scored = await scoreConversation(supabase, conversation as ScorableConversation);
  const card = scored.scorecard;
  const pipeline = (await conversationPipeline(supabase)).get(id);
  const stage = stageOf(pipeline);
  const command = nextCommand(stage, id);
  // Extraction ran and stored nothing. Worth saying plainly rather than
  // leaving a reader to wonder whether the pass is still owed.
  const foundNothing =
    stage === 'processed' && (pipeline?.signals ?? 0) === 0 && (pipeline?.extractionRuns ?? 0) > 0;
  const observed = card.criteria.some((criterion) => criterion.status !== 'unobserved');

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
        {segments.length} segments · {signals.length} signals · {scored.engagementType} v
        {scored.criteriaVersion}
      </p>

      {/*
        Where this call has got to, and what would move it on.
        An imported transcript arrives finished, so this says nothing for
        most conversations. A live-captured one does not, and without this it
        is indistinguishable from a finished call that simply scored badly —
        which is the opposite fact.
      */}
      {command && (
        <section aria-labelledby="pipeline-heading" className="card">
          <h2 id="pipeline-heading" style={{ marginTop: 0 }}>
            {stage === 'captured' ? 'Not scored yet' : 'No signals yet'}
          </h2>
          {/* "No signals" rather than "not extracted": nothing here can tell
              a pass that never ran from one that ran and found nothing it
              could evidence, and claiming the first would be asserting more
              than is known. */}
          <p className="muted" style={{ margin: 0 }}>
            {stage === 'captured'
              ? 'This call was captured but no criteria have been detected over it.'
              : 'Nothing has been extracted from this call, so it cannot contribute to an ' +
                'insight. Running the pass will either extract something or confirm there ' +
                'is nothing to extract. Extraction is Opus and embedding is a local model, ' +
                'so it is an operator pass rather than a button here.'}
          </p>
          <code className="command">{command}</code>
        </section>
      )}

      <section aria-labelledby="scorecard-heading">
        <h2 id="scorecard-heading">Scorecard</h2>
        {!observed ? (
          <p className="muted">
            Not scored yet — which is not the same as scoring zero. Run{' '}
            <code>pnpm score --conversation {id}</code> to detect criteria over this transcript.
          </p>
        ) : (
          <>
            <p>
              <span className="score">{Math.round(card.score)}</span>
              <span className="score-unit">
                {' '}
                / 100 · {card.earnedWeight} of {card.totalWeight} confirmed
              </span>
            </p>
            <ul className="signals">
              {card.criteria.map((criterion) => (
                <li key={criterion.key} className="signal">
                  <div className="criterion">
                    <span>{criterion.label}</span>
                    <span className={`state state-${criterion.status}`}>{criterion.status}</span>
                  </div>
                  {/* Every state above rests on something somebody said, and
                      the quote is a link to where they said it — invariant 4
                      is not a claim this page makes, it is one it shows. */}
                  {criterion.evidence.length > 0 && (
                    <ul className="evidence">
                      {criterion.evidence.map((recorded) => (
                        <li key={`${recorded.span.segmentId}-${recorded.seq}`}>
                          <a href={`#segment-${recorded.span.segmentId}`}>
                            “{recorded.span.quote}”{' '}
                            <span className="muted">at {clock(recorded.span.startMs)}</span>
                          </a>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
            <p className="muted" style={{ fontSize: '0.82rem' }}>
              Computed from {scored.detectors.join(', ') || 'no detector'} · the score is not
              stored, it is derived from the quotes above each time this page loads.
            </p>
          </>
        )}
      </section>

      <section aria-labelledby="signals-heading">
        <h2 id="signals-heading">Signals</h2>
        {signals.length === 0 ? (
          <p className="muted">
            {foundNothing
              ? 'Extraction has run over this call and found nothing it could evidence. ' +
                'That is an answer, not an omission — a conversation with no stated problem ' +
                'and no request produces no signals.'
              : 'Nothing extracted yet. Run pnpm process against this conversation.'}
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
