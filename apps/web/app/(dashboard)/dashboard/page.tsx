import { engagementLabel, sampleCallOffered } from '@/lib/company';
import Link from 'next/link';
import { GettingStarted } from '@/components/getting-started';
import { ScorecardStrip } from '@/components/scorecard-strip';
import { listAccounts } from '@/lib/accounts';
import { accountsNeedingAttention } from '@/lib/accounts-attention';
import { coachingCallsFrom, loadScoredCalls } from '@/lib/coaching-data';
import { coverageBySet as coverageForSets } from '@/lib/coverage';
import { goalStandings, homeAgenda, type AgendaItem } from '@/lib/home';
import { speakerKey, talkBySeller } from '@/lib/talk';
import { themesOverTime } from '@/lib/themes';
import { readAll } from '@tesserafy/db';
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

const KIND_LABEL: Record<AgendaItem['kind'], string> = {
  prep: 'Call',
  assigned: 'Yours',
  decide: 'Decide',
  customer: 'Customer',
  goal: 'Goal',
  theme: 'Theme',
};

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
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const now = new Date();

  // Every row, not the first thousand (see readAll). The calls are fetched and
  // scored once, for the meetings, the coverage and the agenda alike.
  const [{ rows, scores }, signals, insights, evidence, accounts, { data: membership }, { data: goalRows }, { data: ourRows }] =
    await Promise.all([
      loadScoredCalls(supabase),
      readAll<{ id: string; conversation_id: string; kind: string }>(
        (from, to) => supabase.from('signals').select('id, conversation_id, kind').order('id').range(from, to),
        'Could not load the dashboard',
      ),
      readAll<{ id: string; title: string; status: string; assigned_to: string | null }>(
        (from, to) => supabase.from('insights').select('id, title, status, assigned_to').order('id').range(from, to),
        'Could not load the dashboard',
      ),
      readAll<{ insight_id: string; signal_id: string }>(
        (from, to) => supabase.from('insight_evidence').select('insight_id, signal_id').order('id').range(from, to),
        'Could not load the dashboard',
      ),
      listAccounts(supabase),
      supabase.from('company_members').select('role').eq('user_id', user?.id ?? '').limit(1).maybeSingle(),
      supabase.from('criterion_goals').select('engagement_type, criterion_key, target'),
      supabase.from('our_speakers').select('name'),
    ]);
  // Newest first, a call with no meeting date by when it was added.
  const conversations = [...rows].sort((a, b) =>
    (b.occurred_at ?? b.created_at).localeCompare(a.occurred_at ?? a.created_at),
  );
  const calls = coachingCallsFrom(rows, scores);
  const isOwner = membership?.role === 'owner';
  const signalCount = signals.length;

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

  // What needs you: each part from the same rules as the page that owns it.
  const newestCall = new Map<string, { date: string; score: number | null }>();
  for (const call of calls) {
    if (!call.accountId) continue;
    const seen = newestCall.get(call.accountId);
    if (!seen || call.date > seen.date) newestCall.set(call.accountId, { date: call.date, score: call.score });
  }
  const customers = accountsNeedingAttention(
    accounts.map((account) => ({ ...account, lastScore: newestCall.get(account.id)?.score ?? null })),
    now,
  );
  const themes = themesOverTime(
    {
      insights,
      evidence: evidence.map((row) => ({ insightId: row.insight_id, signalId: row.signal_id })),
      signals: signals.map((row) => ({ id: row.id, conversationId: row.conversation_id, kind: row.kind })),
      callDate: new Map(rows.map((row) => [row.id, row.occurred_at ?? row.created_at])),
    },
    now,
  ).themes;
  // An owner is measured on the team's calls; a member on their own.
  const measured = isOwner ? calls : calls.filter((call) => call.addedBy === user?.id);
  const goals = goalStandings(
    measured,
    (goalRows ?? []).map((row) => ({ engagementType: row.engagement_type, key: row.criterion_key, target: Number(row.target) })),
    now,
  );
  // Calls someone prepared for in the next three days.
  const { data: prepRows } = await supabase
    .from('call_preps')
    .select('id, person_name, account_id, call_at, brief')
    .gte('call_at', now.toISOString())
    .lte('call_at', new Date(now.getTime() + 3 * 86_400_000).toISOString())
    .order('call_at')
    .limit(10);
  const accountName = new Map(accounts.map((account) => [account.id, account.name]));
  const agenda = homeAgenda({
    preps: (prepRows ?? []).map((row) => ({
      id: row.id,
      personName: row.person_name,
      customer: row.account_id ? (accountName.get(row.account_id) ?? null) : null,
      callAt: row.call_at ?? now.toISOString(),
      hasBrief: row.brief !== null,
    })),
    assignedToYou: insights.filter((insight) => insight.assigned_to === user?.id && insight.status !== 'dismissed'),
    waitingForDecision: insights.filter((insight) => insight.status === 'proposed').length,
    customers,
    goals,
    themes,
  });

  // Your side's share of the talking on your own calls, once names are marked.
  const ours = new Set((ourRows ?? []).map((row) => speakerKey(row.name)));
  const since = new Date(now.getTime() - 28 * 86_400_000).toISOString();
  const { data: talkRows } = ours.size > 0 && user ? await supabase.rpc('conversation_talk', { p_since: since }) : { data: [] };
  const talked = user
    ? talkBySeller(
        (talkRows ?? []).map((row) => ({ conversationId: row.conversation_id, speaker: row.speaker, words: Number(row.words) })),
        ours,
        new Map(rows.map((row) => [row.id, row.added_by])),
      ).get(user.id)
    : undefined;

  const coverageBySet = coverageForSets(scored, scores);

  const recent = conversations.slice(0, RECENT);
  const approved = insights.filter((insight) => insight.status === 'approved').length;

  return (
    <main className="wide">
      <h1>Dashboard</h1>
      <p className="muted">
        Every meeting your company has imported, scored against its criteria. Each score is worked
        out from the quoted evidence behind it, every time this page loads.
      </p>

      {/* The first page after a pilot's first sign-in; say what fills it. */}
      {conversations.length === 0 ? (
        <div style={{ marginTop: '1.5rem' }}>
          <GettingStarted offerSample={await sampleCallOffered(supabase)} />
        </div>
      ) : null}

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
          <span className="stat-value">{signalCount}</span>
          <span className="stat-label">signals, each with a quote</span>
        </div>
        <div className="card">
          <span className="stat-value">{insights.length}</span>
          <span className="stat-label">
            insights{insights.length > 0 && `, ${approved} approved`}
          </span>
        </div>
        {talked ? (
          <div className="card">
            <span className="stat-value">{Math.round(talked.share * 100)}%</span>
            <span className="stat-label">
              of the talking was your side&apos;s, on your {talked.calls} call{talked.calls === 1 ? '' : 's'} in four weeks
            </span>
          </div>
        ) : null}
      </div>

      {conversations.length > 0 ? (
        <section aria-labelledby="agenda-heading" className="card" style={{ marginTop: '1.5rem' }}>
          <h2 id="agenda-heading" style={{ marginTop: 0 }}>
            Needs you
          </h2>
          {agenda.length === 0 ? (
            <p className="muted" style={{ marginBottom: 0 }}>
              Nothing today: no insight waiting on you, no customer gone quiet, no goal missed, no theme climbing.
            </p>
          ) : (
            <ul className="agenda">
              {agenda.map((item) => (
                <li key={`${item.kind}-${item.href}-${item.text}`}>
                  <span className={`agenda-kind agenda-${item.kind}`}>{KIND_LABEL[item.kind]}</span>
                  <Link href={item.href}>{item.text}</Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

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
                      {when(conversation.occurred_at)} · {engagementLabel(conversation.engagement_type)}
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
                Nothing scored yet. Each call is scored on its own a couple of minutes after it
                is imported.
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
