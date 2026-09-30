import Link from 'next/link';
import { isProvider, PROVIDER_NAME } from '@/lib/trackers';
import { notFound } from 'next/navigation';
import { clock } from '@/lib/highlight';
import { createClient } from '@/lib/supabase/server';
import { Decide } from './decide';
import { CommentOnInsight, WorkOnInsight } from '@/components/insight-work';

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
    .select('id, company_id, title, summary, created_at, status, assigned_to')
    .eq('id', id)
    .maybeSingle();

  if (!insight) notFound();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const [{ data: ticket }, { data: tracker }, { data: team }, { data: membership }, { data: comments }, { data: events }, { data: others }, { data: ticketed }] =
    await Promise.all([
      supabase.from('insight_tickets').select('url').eq('insight_id', id).maybeSingle(),
      // Where a ticket would go; never the token (ADR 0015).
      supabase.from('company_trackers').select('provider, target').eq('company_id', insight.company_id).maybeSingle(),
      supabase.rpc('company_team'),
      supabase.from('company_members').select('role').eq('user_id', user?.id ?? '').eq('company_id', insight.company_id).maybeSingle(),
      supabase.from('insight_comments').select('id, author, body, created_at').eq('insight_id', id).order('created_at'),
      supabase.from('insight_events').select('kind, detail, actor, at').eq('insight_id', id).order('at', { ascending: false }),
      supabase
        .from('insights')
        .select('id, title')
        .eq('company_id', insight.company_id)
        .neq('id', id)
        .neq('status', 'dismissed')
        .order('title')
        .limit(200),
      supabase.from('insight_tickets').select('insight_id'),
    ]);
  const isOwner = membership?.role === 'owner';
  const nameOf = new Map((team ?? []).map((person) => [person.user_id, person.is_you ? 'You' : person.email]));
  const who = (userId: string | null) => (userId ? (nameOf.get(userId) ?? 'A former member') : 'A former member');
  // A ticketed insight cannot be folded into another; its ticket would lead nowhere.
  const hasTicket = new Set((ticketed ?? []).map((row) => row.insight_id));
  const mergeable = (others ?? []).filter((other) => !hasTicket.has(other.id));

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

  const { title, summary, status, assigned_to: assignedTo } = insight as {
    title: string;
    summary: string;
    status: string;
    assigned_to: string | null;
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
        {assignedTo ? ` · owned by ${who(assignedTo)}` : ''}
      </p>
      <WorkOnInsight
        insightId={id}
        title={title}
        summary={summary}
        assignee={assignedTo}
        team={(team ?? []).map((person) => ({ id: person.user_id, email: person.email }))}
        others={mergeable}
        isOwner={isOwner}
      />

      <Decide
        insightId={id}
        status={status}
        ticketUrl={(ticket)?.url ?? null}
        trackerTarget={
          tracker ? `${PROVIDER_NAME[isProvider(tracker.provider) ? tracker.provider : 'github']} (${tracker.target})` : null
        }
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

      <section aria-labelledby="discussion-heading">
        <h2 id="discussion-heading">Discussion</h2>
        {(comments ?? []).length === 0 ? <p className="muted">Nothing said yet.</p> : null}
        <ul className="notes">
          {(comments ?? []).map((comment) => (
            <li key={comment.id} className="note">
              <p>{comment.body}</p>
              <div className="muted note-meta">
                {who(comment.author)}, {new Date(comment.created_at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' })} UTC
              </div>
            </li>
          ))}
        </ul>
        <CommentOnInsight insightId={id} />
      </section>

      {(events ?? []).length > 0 ? (
        <details className="call-history">
          <summary className="muted">Changes to this insight ({(events ?? []).length})</summary>
          <ul className="muted">
            {(events ?? []).map((event, index) => (
              <li key={`${event.at}-${index}`}>
                {new Date(event.at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' })} UTC —{' '}
                {who(event.actor)}{' '}
                {event.kind === 'renamed' ? `reworded it (${event.detail ?? ''})` : event.kind === 'assigned' ? `assigned it to ${event.detail ?? 'nobody'}` : `merged in ${event.detail ?? 'another insight'}`}
                .
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </main>
  );
}
