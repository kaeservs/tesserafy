import { PlanStrip, nearestLimit } from '@/components/plan-strip';
import { engagementLabel, liveCallsAvailable, sampleCallOffered } from '@/lib/company';
import { Onboarding, TourButton } from '@/components/onboarding';
import type { PlanOverview } from '@/components/plan-panel';
import { PricingCards } from '@/components/pricing-cards';
import { billingMode } from '@/lib/billing';
import { CATALOG_COLUMNS } from '@/lib/plan-catalog';
import Link from 'next/link';
import { GettingStarted } from '@/components/getting-started';
import { ScorecardStrip } from '@/components/scorecard-strip';
import { listAccounts } from '@/lib/accounts';
import { accountsNeedingAttention } from '@/lib/accounts-attention';
import { coachingCallsFrom, loadScoredCalls } from '@/lib/coaching-data';
import { coverageBySet as coverageForSets } from '@/lib/coverage';
import { goalStandings, homeAgenda, type AgendaItem } from '@/lib/home';
import { ourSpeakerKeys, talkBySeller } from '@/lib/talk';
import { themesOverTime } from '@/lib/themes';
import { fetchCriteriaSets, readAll } from '@tesserafy/db';
import { CallTypeForm } from '@/components/guidance-forms';
import { defaultPurpose } from '@/lib/guidance';
import { myCompanyId } from '@/lib/company';
import { createClient } from '@/lib/supabase/server';
import { Icon } from '@/components/icons';
import { callsThisWeek, followUps, myCalls } from '@/lib/home-calls';
import { liveSetup } from '@/lib/live-setup';
import { syncCalendars } from '@/lib/calendar-sync';
import { prepareFromEvent } from '../prep/calendar-actions';

/**
 * Home. It leads with the seller's own calls, the way the product is used
 * now (Cluely-style, around the call): the next one and what is prepared for
 * it, the last one and its follow-up email, the follow-ups still to send, and
 * a question to ask of every past call. Below that, the team's numbers, as
 * before:
 *
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
  coaching: 'Coaching',
  action: 'To do',
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
  // Owners set what kind of call each scorecard is for, right here.
  const companyId = isOwner ? await myCompanyId(supabase, user?.id) : null;
  const [callSets, { data: purposeRows }, { data: companyRow }] = companyId
    ? await Promise.all([
        fetchCriteriaSets(supabase, companyId),
        supabase.from('scorecard_purposes').select('engagement_type, purpose').eq('company_id', companyId),
        supabase.from('companies').select('default_engagement_type').eq('id', companyId).maybeSingle(),
      ])
    : [[], { data: [] }, { data: null }];
  const callTypes = [...new Set(callSets.map((set) => set.engagementType))];
  const purposeByType = new Map((purposeRows ?? []).map((row) => [row.engagement_type, row.purpose]));
  const defaultType = companyRow?.default_engagement_type ?? 'discovery';

  // Coaching waiting on you.
  const { data: coachingRows } = await supabase
    .from('coaching_assignments')
    .select('id, conversation_id, segment_id, assigned_by')
    .eq('assigned_to', user?.id ?? '')
    .eq('status', 'open')
    .order('created_at', { ascending: false })
    .limit(20);
  const titleOfCall = new Map(rows.map((row) => [row.id, row.title]));
  const { data: teamRows } = (coachingRows ?? []).length > 0 ? await supabase.rpc('company_team') : { data: [] };
  const emailOf = new Map((teamRows ?? []).map((person) => [person.user_id, person.email]));
  // What your side committed to on your own calls in the last month, not yet done.
  const myCallIds = rows.filter((row) => row.added_by === user?.id).map((row) => row.id);
  const { data: actionRows } =
    myCallIds.length > 0
      ? await supabase
          .from('action_items')
          .select('id, action, due, conversation_id, segment_id, created_at')
          .in('conversation_id', myCallIds.slice(0, 200))
          .eq('owner_side', 'ours')
          .eq('done', false)
          .gte('created_at', new Date(now.getTime() - 30 * 86_400_000).toISOString())
          .order('created_at', { ascending: false })
          .limit(20)
      : { data: [] };
  const agenda = homeAgenda({
    actions: (actionRows ?? []).map((row) => ({
      id: row.id,
      action: row.action,
      due: row.due,
      callTitle: titleOfCall.get(row.conversation_id) ?? 'a call',
      conversationId: row.conversation_id,
      segmentId: row.segment_id,
    })),
    coaching: (coachingRows ?? []).map((row) => ({
      id: row.id,
      callTitle: titleOfCall.get(row.conversation_id) ?? 'a call',
      conversationId: row.conversation_id,
      segmentId: row.segment_id,
      from: row.assigned_by ? (emailOf.get(row.assigned_by) ?? null) : null,
    })),
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

  // Your side's share of the talking on your own calls: live calls that heard
  // both sides by themselves, others once names are marked.
  const ours = ourSpeakerKeys(ourRows);
  const since = new Date(now.getTime() - 28 * 86_400_000).toISOString();
  const { data: talkRows } = user ? await supabase.rpc('conversation_talk', { p_since: since }) : { data: [] };
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

  // ---- The seller's own calls, for the top of the page.
  const mine = user ? myCalls(rows, user.id) : [];
  const recentMine = mine.filter((call) => (call.occurred_at ?? call.created_at) >= new Date(now.getTime() - 14 * 86_400_000).toISOString());
  const last = mine[0] ?? null;
  const [{ data: draftedRows }, lastActions, setup] = await Promise.all([
    recentMine.length > 0 || last
      ? supabase
          .from('follow_ups')
          .select('conversation_id')
          .in('conversation_id', [...new Set([...recentMine.map((call) => call.id), ...(last ? [last.id] : [])])])
      : Promise.resolve({ data: [] as { conversation_id: string }[] }),
    last
      ? supabase.from('action_items').select('id', { count: 'exact', head: true }).eq('conversation_id', last.id)
      : Promise.resolve({ count: 0 }),
    user ? liveSetup(supabase, user.id, now) : Promise.resolve(null),
  ]);
  const drafted = new Set((draftedRows ?? []).map((row) => row.conversation_id));
  const toSend = followUps(mine, drafted, accountName, now);
  const waiting = toSend.filter((row) => !row.drafted).length;
  const lastCard = last ? scores.get(last.id) : undefined;
  const lastScored = lastCard?.scorecard.criteria.some((c) => c.status !== 'unobserved') ?? false;
  const local = (user?.email ?? '').split('@')[0] ?? '';
  const name = (local.split(/[._-]/)[0] ?? local).replace(/^./, (first) => first.toUpperCase()) || 'there';
  const prep = setup?.prep ?? null;
  // With nothing prepared, the next customer meeting from the calendar, if one is connected.
  if (!prep && user) await syncCalendars(supabase, user.id, { now });
  const { data: nextMeeting } = prep
    ? { data: null }
    : await supabase
        .from('calendar_events')
        .select('id, title, starts_at, attendees, prep_id')
        .gte('ends_at', now.toISOString())
        .order('starts_at')
        .limit(1)
        .maybeSingle();
  const meetingWith = Array.isArray(nextMeeting?.attendees)
    ? (nextMeeting.attendees as { email?: string; name?: string | null }[]).map((a) => a.name || a.email).filter(Boolean).slice(0, 2).join(', ')
    : '';

  // The plan, for the strip that says when it is running out (components/plan-strip).
  const { data: planData } = await supabase.rpc('plan_overview');
  const planOverview = planData as unknown as PlanOverview | null;

  // The plans above this one, and the first-run steps (components/pricing-cards, components/onboarding).
  const [{ data: catalog }, { data: myPreferences }, { count: overlays }, offerSample, billing] = await Promise.all([
    supabase.from('plans').select(CATALOG_COLUMNS).order('rank'),
    supabase.from('user_preferences').select('onboarded_at').eq('user_id', user?.id ?? '').maybeSingle(),
    supabase.from('overlay_seen').select('user_id', { count: 'exact', head: true }).eq('user_id', user?.id ?? ''),
    sampleCallOffered(supabase),
    companyId ? billingMode(supabase, companyId) : Promise.resolve('free' as const),
  ]);
  const currentPlan = catalog?.find((row) => row.id === planOverview?.plan) ?? null;
  const upgrades = (catalog ?? []).filter(
    (row) => row.per_seat && row.price_usd_cents !== null && row.rank > (currentPlan?.rank ?? 0),
  );
  const pricing = planOverview ? (
    <PricingCards
      plans={upgrades}
      currentName={planOverview.plan_name}
      seats={Math.max(planOverview.seats ?? 1, planOverview.members ?? 1)}
      isOwner={isOwner}
      billing={billing}
    />
  ) : null;
  // First on Home while the plan is the small one or running out; at the foot otherwise.
  const plansFirst =
    planOverview !== null &&
    (['none', 'free', 'trial'].includes(planOverview.plan) || (nearestLimit(planOverview.meters)?.share ?? 0) >= 0.8);

  return (
    <main className="wide">
      <h1>Hello {name} 👋,</h1>
      <p className="muted">
        {now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })}
      </p>
      {planOverview ? (
        <PlanStrip plan={planOverview.plan} planName={planOverview.plan_name} meters={planOverview.meters} isOwner={isOwner} />
      ) : null}
      {plansFirst ? pricing : null}
      <Onboarding
        show={myPreferences?.onboarded_at == null}
        isOwner={isOwner}
        overlayInstalled={(overlays ?? 0) > 0}
        hasCalls={conversations.length > 0}
        offerSample={offerSample}
        live={liveCallsAvailable(planOverview?.plan)}
        plan={
          currentPlan && planOverview
            ? { row: currentPlan, seats: planOverview.seats ?? 1, members: planOverview.members ?? 1 }
            : null
        }
      />

      <div className="grid stats-row" style={{ marginTop: '1.25rem' }}>
        <div className="card stat-card">
          <span className="stat-icon"><Icon name="calls" size={28} /></span>
          <span>
            <span className="stat-label">Your calls this week</span>
            <span className="stat-value">{callsThisWeek(mine, now)}</span>
          </span>
        </div>
        <div className="card stat-card">
          <span className="stat-icon"><Icon name="prepare" size={28} /></span>
          <span>
            <span className="stat-label">Follow-ups to send</span>
            <span className="stat-value">{waiting}</span>
          </span>
        </div>
        <div className="card stat-card">
          <span className="stat-icon"><Icon name="insights" size={28} /></span>
          <span>
            <span className="stat-label">Your open to-dos</span>
            <span className="stat-value">{(actionRows ?? []).length}</span>
          </span>
        </div>
      </div>

      <div className="split-even" style={{ marginTop: '1.25rem' }}>
        <section className="card" aria-labelledby="next-heading">
          <h2 id="next-heading">Your next call</h2>
          {prep ? (
            <>
              <p style={{ marginBottom: '0.25rem' }}>
                <strong>{prep.person}</strong>
                {setup?.account ? <> · {setup.account.name}</> : null}
              </p>
              <p className="muted" style={{ marginTop: 0 }}>
                {prep.callAt
                  ? new Date(prep.callAt).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }) + ' UTC'
                  : 'No time set'}
                {prep.chosen ? ' · set for the overlay' : ''}
              </p>
              <p className="toolbar" style={{ marginBottom: 0 }}>
                <Link href="/prep">The prep and its questions</Link>
                <Link href="/overlay">Open the overlay</Link>
              </p>
            </>
          ) : nextMeeting ? (
            <>
              <p style={{ marginBottom: '0.25rem' }}>
                <strong>{nextMeeting.title}</strong>
                {meetingWith ? <> · {meetingWith}</> : null}
              </p>
              <p className="muted" style={{ marginTop: 0 }}>
                {new Date(nextMeeting.starts_at).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })}{' '}
                UTC · from your calendar, not prepared yet
              </p>
              {nextMeeting.prep_id ? (
                <Link href={`/prep/${nextMeeting.prep_id}`}>Open the prep</Link>
              ) : (
                <form action={prepareFromEvent} className="inline-form">
                  <input type="hidden" name="eventId" value={nextMeeting.id} />
                  <button type="submit">Prepare it</button>
                </form>
              )}
            </>
          ) : (
            <p className="muted" style={{ marginBottom: 0 }}>
              Nothing prepared. <Link href="/prep">Prepare for a call</Link> and mark it “Use for my next call”: the
              overlay then knows who it is with, the scorecard and what to ask.{' '}
              <Link href="/account/calendar">Connect your calendar</Link> and your next customer meeting shows here.
            </p>
          )}
        </section>

        <section className="card" aria-labelledby="last-heading">
          <h2 id="last-heading">Your last call</h2>
          {last ? (
            <>
              <p style={{ marginBottom: '0.25rem' }}>
                <Link href={`/conversations/${last.id}`}>{last.title}</Link>
              </p>
              <p className="muted" style={{ marginTop: 0 }}>
                {when(last.occurred_at ?? last.created_at)}
                {last.account_id && accountName.get(last.account_id) ? ` · ${accountName.get(last.account_id)}` : ''}
                {' · '}
                {lastScored && lastCard ? `scored ${Math.round(lastCard.scorecard.score)}` : 'not scored yet'}
                {' · '}
                {lastActions.count ?? 0} action item{lastActions.count === 1 ? '' : 's'}
              </p>
              <p className="toolbar" style={{ marginBottom: 0 }}>
                <span className={`pill ${drafted.has(last.id) ? 'pill-on' : 'pill-off'}`}>
                  {drafted.has(last.id) ? 'Follow-up drafted' : 'No follow-up yet'}
                </span>
                <Link href={`/conversations/${last.id}/follow-up`}>
                  {drafted.has(last.id) ? 'Open the follow-up email' : 'Draft the follow-up email'}
                </Link>
              </p>
            </>
          ) : (
            <p className="muted" style={{ marginBottom: 0 }}>
              No calls of yours yet. Run the overlay on your next call, or <Link href="/conversations/new">import one</Link>.
            </p>
          )}
        </section>
      </div>

      {toSend.length > 0 ? (
        <section className="card" aria-labelledby="followups-heading" style={{ marginTop: '1.25rem' }}>
          <h2 id="followups-heading">Follow-ups, last two weeks</h2>
          <table>
            <thead>
              <tr>
                <th>Call</th>
                <th>Customer</th>
                <th>When</th>
                <th>Follow-up</th>
              </tr>
            </thead>
            <tbody>
              {toSend.map((row) => (
                <tr key={row.id}>
                  <td>
                    <Link href={`/conversations/${row.id}/follow-up`}>{row.title}</Link>
                  </td>
                  <td className="muted">{row.customer ?? '—'}</td>
                  <td className="muted">{when(row.date)}</td>
                  <td>
                    <span className={`pill ${row.drafted ? 'pill-on' : 'pill-off'}`}>{row.drafted ? 'Drafted' : 'To send'}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}

      <section className="card" aria-labelledby="ask-heading" style={{ marginTop: '1.25rem' }}>
        <h2 id="ask-heading">Ask your calls</h2>
        <form action="/ask" method="get" className="toolbar">
          <input
            name="q"
            className="grow"
            placeholder="What do customers say slows their reporting down?"
            aria-label="A question about your calls"
            maxLength={500}
          />
          <button type="submit">Ask</button>
        </form>
      </section>

      <h2 style={{ marginTop: '2.5rem' }}>Across the team</h2>
      <p className="muted">
        Every meeting your company has imported, scored against its criteria. Each score is worked
        out from the quoted evidence behind it, every time this page loads.
      </p>

      {/* The first page after a pilot's first sign-in; say what fills it. */}
      {conversations.length === 0 ? (
        <div style={{ marginTop: '1.5rem' }}>
          <GettingStarted offerSample={offerSample} tour={<TourButton />} />
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

      {isOwner && callTypes.length > 0 ? (
        <section aria-labelledby="call-types-heading" className="card" style={{ marginTop: '1.5rem' }}>
          <h2 id="call-types-heading" style={{ marginTop: 0 }}>
            Call types
          </h2>
          <p className="muted" style={{ marginTop: 0 }}>
            What each scorecard is for. Scoring, insights, action items and call prep all lean that way: a sales call is read for
            buying signals, and its prep looks at their company. <Link href="/guidance">What the AI has learned</Link>
          </p>
          {callTypes.map((type) => (
            <CallTypeForm
              key={type}
              engagementType={type}
              label={engagementLabel(type)}
              purpose={purposeByType.get(type) ?? defaultPurpose(type)}
              isDefault={type === defaultType}
            />
          ))}
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
      {plansFirst ? null : <div style={{ marginTop: '2.5rem' }}>{pricing}</div>}
    </main>
  );
}
