import Link from 'next/link';
import { ScorecardStrip } from '@/components/scorecard-strip';
import { conversationPipeline, stageOf } from '@/lib/pipeline';
import { scoreConversations, type ScorableConversation } from '@/lib/scorecard';
import { createClient } from '@/lib/supabase/server';

/**
 * Every meeting, with how it scored.
 *
 * No company filter in this query, on purpose. It runs as the signed-in user,
 * so RLS alone decides which rows come back — this page is the "via API" leg
 * of the P0 gate made visible.
 *
 * Scores are computed here rather than read: `criterion_events` holds quoted
 * spans, and `score(replay(...))` turns them into a number at request time.
 * Scoring the whole list costs one query for the events and one per distinct
 * criteria set, not one per meeting.
 */

interface ConversationRow {
  id: string;
  title: string;
  occurred_at: string | null;
  engagement_type: string;
  criteria_version: number;
  companies: { name: string } | { name: string }[] | null;
}

function when(occurredAt: string | null): string {
  if (!occurredAt) return 'no date';
  return new Date(occurredAt).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

// Without generated types, supabase-js cannot tell a to-one embed from a
// to-many one. Replace with packages/db generated types once they exist.
function companyName(embed: ConversationRow['companies']): string {
  const row = Array.isArray(embed) ? embed[0] : embed;
  return row?.name ?? '';
}

export default async function ConversationsPage({
  searchParams,
}: {
  searchParams: Promise<{ erased?: string; tickets?: string }>;
}) {
  const { erased, tickets } = await searchParams;
  const exported = Number(tickets ?? 0);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('conversations')
    .select('id, title, occurred_at, engagement_type, criteria_version, companies ( name )')
    .order('occurred_at', { ascending: false });

  if (error) {
    throw new Error(`Could not load conversations: ${error.message}`);
  }

  const conversations = (data ?? []) as ConversationRow[];
  const [scores, pipeline] = await Promise.all([
    scoreConversations(supabase, conversations as ScorableConversation[]),
    conversationPipeline(supabase),
  ]);

  return (
    <main className="wide">
      <div className="section-head" style={{ marginTop: 0 }}>
        <h1>Meetings</h1>
        <Link href="/conversations/new">Import a transcript</Link>
      </div>
      {erased ? (
        <p className="card" role="status">
          The call was deleted, with everything derived from it.
          {exported > 0
            ? ` ${exported} ticket${exported === 1 ? ' was' : 's were'} exported from it to your ` +
              'tracker earlier; those live in the tracker and were not deleted — remove them there ' +
              'if they should go too.'
            : ''}
        </p>
      ) : null}
      <p className="muted">
        {conversations.length} conversation{conversations.length === 1 ? '' : 's'}, newest first.
        Each score is computed from the quoted evidence behind it.
      </p>

      {conversations.length === 0 ? (
        <div className="meetings" style={{ marginTop: '1.5rem' }}>
          <p className="empty">
            Nothing here yet. If you expected conversations, your account may not be attached to a
            company.
          </p>
        </div>
      ) : (
        <ul className="meetings" style={{ marginTop: '1.5rem' }}>
          {conversations.map((conversation) => {
            const card = scores.get(conversation.id);
            const observed = card?.scorecard.criteria.some((c) => c.status !== 'unobserved');
            const stage = stageOf(pipeline.get(conversation.id));

            return (
              <li key={conversation.id} className="meeting">
                <Link href={`/conversations/${conversation.id}`} className="meeting-title">
                  {conversation.title}
                </Link>
                <span className="meeting-meta">
                  {when(conversation.occurred_at)}
                  {companyName(conversation.companies) &&
                    ` · ${companyName(conversation.companies)}`}{' '}
                  · {conversation.engagement_type} v{conversation.criteria_version}
                  {/* One word for how far this call has got. An imported
                      transcript arrives finished; a live one does not, and
                      looked identical to a finished call that scored badly. */}
                  {stage !== 'processed' && <span className={`stage stage-${stage}`}>{stage}</span>}
                </span>
                <span className="meeting-score">
                  {card && observed ? (
                    <>
                      <ScorecardStrip scorecard={card.scorecard} />
                      <span className="score-figure">{Math.round(card.scorecard.score)}</span>
                    </>
                  ) : (
                    // "Not scored" and a zero look the same to a reader in a
                    // hurry and mean opposite things, so they never share a
                    // rendering.
                    <span className="muted">not scored</span>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
