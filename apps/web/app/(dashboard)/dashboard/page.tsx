import Link from 'next/link';
import { ScorecardStrip } from '@/components/scorecard-strip';
import { coverageBySet as coverageForSets } from '@/lib/coverage';
import { scoreConversations } from '@/lib/scorecard';
import { createClient } from '@/lib/supabase/server';

/**
 * The dashboard: every meeting, how each one scored, and what the criteria
 * look like across all of them.
 *
 * The question this page exists to answer is not "how did that call go" —
 * the meeting page answers that. It is the one nobody can answer from a stack
 * of individual calls: *which criteria does this team consistently fail to
 * establish*. A criterion confirmed in two meetings out of thirty is not a
 * scoring problem, it is a question nobody is asking, and it is invisible
 * until the meetings are counted together.
 *
 * Every number here is computed, not stored. Scores come out of
 * `score(replay(...))` in packages/scoring, from the quoted spans in
 * `criterion_events` — the same pure functions the live overlay runs
 * (invariant 1). Nothing on this page could show a number a model produced.
 *
 * No company filter in any query: they run as the signed-in user and RLS
 * decides, which is the P0 gate made visible on the busiest page in the app.
 */

interface ConversationRow {
  id: string;
  title: string;
  occurred_at: string | null;
  engagement_type: string;
  criteria_version: number;
}

/** Enough to be worth scanning; the meetings page has the rest. */
const RECENT = 12;

function when(occurredAt: string | null): string {
  if (!occurredAt) return 'no date';
  return new Date(occurredAt).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export default async function DashboardPage() {
  const supabase = await createClient();

  const [conversationsResult, signalsResult, insightsResult] = await Promise.all([
    supabase
      .from('conversations')
      .select('id, title, occurred_at, engagement_type, criteria_version')
      .order('occurred_at', { ascending: false }),
    supabase.from('signals').select('id'),
    supabase.from('insights').select('id, status'),
  ]);

  const failure = conversationsResult.error ?? signalsResult.error ?? insightsResult.error;
  if (failure) throw new Error(`Could not load the dashboard: ${failure.message}`);

  const conversations = (conversationsResult.data ?? []) as ConversationRow[];
  const signals = (signalsResult.data ?? []);
  const insights = (insightsResult.data ?? []);

  const scores = await scoreConversations(supabase, conversations);

  // A meeting nobody has run `pnpm score` over has no events, which is a
  // different thing from a meeting that scored zero. Saying so is the whole
  // difference between "this call went badly" and "we have not looked".
  const scored = conversations.filter((c) => {
    const card = scores.get(c.id);
    return card ? card.scorecard.criteria.some((k) => k.status !== 'unobserved') : false;
  });

  const averageScore =
    scored.length === 0
      ? null
      : Math.round(
          scored.reduce((sum, c) => sum + (scores.get(c.id)?.scorecard.score ?? 0), 0) /
            scored.length,
        );

  const coverageBySet = coverageForSets(scored, scores);

  const recent = conversations.slice(0, RECENT);
  const approved = insights.filter((insight) => insight.status === 'approved').length;

  return (
    <main className="wide">
      <h1>Dashboard</h1>
      <p className="muted">
        Every conversation this account can see, scored against the criteria it was pinned to.
        Scores are computed from quoted evidence each time this page loads — none of them is stored.
      </p>

      <div className="grid" style={{ marginTop: '1.5rem' }}>
        <div className="card">
          <span className="stat-value">{conversations.length}</span>
          <span className="stat-label">
            meetings{scored.length < conversations.length && `, ${scored.length} scored`}
          </span>
        </div>
        <div className="card">
          <span className="stat-value">{averageScore ?? '—'}</span>
          <span className="stat-label">
            {averageScore === null ? 'nothing scored yet' : `average score across ${scored.length}`}
          </span>
        </div>
        <div className="card">
          <span className="stat-value">{signals.length}</span>
          <span className="stat-label">signals, each with a quote</span>
        </div>
        <div className="card">
          <span className="stat-value">{insights.length}</span>
          <span className="stat-label">
            insights{insights.length > 0 && `, ${approved} approved`}
          </span>
        </div>
      </div>

      <div className="split" style={{ marginTop: '2rem' }}>
        <section aria-labelledby="recent-heading">
          <div className="section-head">
            <h2 id="recent-heading">Recent meetings</h2>
            <Link href="/conversations">All meetings</Link>
          </div>

          {recent.length === 0 ? (
            <div className="meetings">
              <p className="empty">
                No conversations yet. <Link href="/conversations/new">Import a transcript</Link> to
                start.
              </p>
            </div>
          ) : (
            <ul className="meetings">
              {recent.map((conversation) => {
                const card = scores.get(conversation.id);
                const observed = card?.scorecard.criteria.some((c) => c.status !== 'unobserved');

                return (
                  <li key={conversation.id} className="meeting">
                    <Link href={`/conversations/${conversation.id}`} className="meeting-title">
                      {conversation.title}
                    </Link>
                    <span className="meeting-meta">
                      {when(conversation.occurred_at)} · {conversation.engagement_type} v
                      {conversation.criteria_version}
                    </span>
                    <span className="meeting-score">
                      {card && observed ? (
                        <>
                          <ScorecardStrip scorecard={card.scorecard} />
                          <span className="score-figure">{Math.round(card.scorecard.score)}</span>
                        </>
                      ) : (
                        /* Not zero. Zero is a verdict; this is the absence of
                           one, and showing them the same way would libel a
                           call nobody has scored. */
                        <span className="muted">not scored</span>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section aria-labelledby="coverage-heading">
          <div className="section-head">
            <h2 id="coverage-heading">Criteria coverage</h2>
          </div>

          <div className="card">
            {coverageBySet.length === 0 ? (
              <p className="muted">
                Nothing scored yet. Run <code>pnpm score --company &lt;uuid&gt;</code> to score
                imported conversations against their criteria.
              </p>
            ) : (
              coverageBySet.map((set) => (
                <div key={set.label} style={{ marginBottom: '1rem' }}>
                  {/* The heading appears only when there is more than one set.
                      With one it is noise; with two it is the difference
                      between comparable numbers and nonsense. */}
                  {coverageBySet.length > 1 && (
                    <p className="coverage-count" style={{ margin: '0 0 0.35rem' }}>
                      {set.label} · {set.total} meeting{set.total === 1 ? '' : 's'}
                    </p>
                  )}
                  <ul className="coverage">
                    {set.criteria.map((criterion) => {
                      const confirmedPct = (criterion.confirmed / set.total) * 100;
                      const candidatePct = (criterion.candidate / set.total) * 100;

                      return (
                        <li key={criterion.key}>
                          <div className="coverage-head">
                            <span>{criterion.label}</span>
                            <span className="coverage-count">
                              {criterion.confirmed} of {set.total}
                            </span>
                          </div>
                          <div
                            className="bar"
                            role="img"
                            aria-label={`${criterion.label}: confirmed in ${criterion.confirmed} of ${set.total} meetings scored against ${set.label}${criterion.candidate > 0 ? `, partial in ${criterion.candidate}` : ''}`}
                          >
                            <div style={{ display: 'flex', height: '100%' }}>
                              <div className="bar-fill" style={{ width: `${confirmedPct}%` }} />
                              <div
                                className="bar-fill bar-fill-candidate"
                                style={{ width: `${candidatePct}%` }}
                              />
                            </div>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))
            )}
            {coverageBySet.length > 0 && (
              <p className="muted" style={{ fontSize: '0.82rem', margin: 0 }}>
                A criterion rarely confirmed is usually a question nobody is asking, not a
                scoring fault.
              </p>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
