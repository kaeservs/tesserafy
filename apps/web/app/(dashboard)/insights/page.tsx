import Link from 'next/link';
import { FindInsightsButton } from '@/components/find-insights-button';
import { readAll } from '@tesserafy/db';
import { insightPipeline } from '@/lib/insight-pipeline';
import { createClient } from '@/lib/supabase/server';

/**
 * What several conversations say together.
 *
 * Each row shows how much sits behind it — signals and conversations — because
 * "four customers said this" and "one customer said this four times" are
 * different claims, and a reader deciding what to build needs to tell them
 * apart at a glance.
 *
 * No company filter: these queries run as the signed-in user, so RLS decides.
 *
 * Filtered by status with plain links, each carrying its count, so "waiting
 * for you" is one click and says how many before it is clicked.
 */

interface InsightRow {
  id: string;
  title: string;
  summary: string;
  created_at: string;
  status: string;
  decided_at: string | null;
  assigned_to: string | null;
}

interface EvidenceRow {
  insight_id: string;
  signal_id: string;
}

/** Proposed ones wait on a person; the label says so at a glance. */
const STATUS: Record<string, string> = {
  proposed: 'waiting for you',
  approved: 'approved',
  dismissed: 'dismissed',
};

const FILTERS = [
  { status: null, label: 'All' },
  { status: 'mine', label: 'Mine' },
  { status: 'proposed', label: 'Waiting for you' },
  { status: 'approved', label: 'Approved' },
  { status: 'dismissed', label: 'Dismissed' },
] as const;

export default async function InsightsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status: asked } = await searchParams;
  const status = FILTERS.find((filter) => filter.status === asked)?.status ?? null;
  const supabase = await createClient();

  // Every row, not the first thousand: the counts beside each insight are
  // its support, and a count computed from part of the evidence understates
  // exactly the insights that matter most. See readAll.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const [insights, evidence, signals, tickets, calls, accounts, { data: team }] = await Promise.all([
    readAll<InsightRow>(
      (from, to) =>
        supabase
          .from('insights')
          .select('id, title, summary, created_at, status, decided_at, assigned_to')
          .order('created_at', { ascending: false })
          .order('id')
          .range(from, to),
      'Could not load insights',
    ),
    readAll<EvidenceRow>(
      (from, to) =>
        supabase.from('insight_evidence').select('insight_id, signal_id').order('id').range(from, to),
      'Could not load insights',
    ),
    readAll(
      (from, to) =>
        supabase.from('signals').select('id, conversation_id').order('id').range(from, to),
      'Could not load insights',
    ),
    readAll<{ insight_id: string; created_at: string }>(
      (from, to) => supabase.from('insight_tickets').select('insight_id, created_at').order('id').range(from, to),
      'Could not load insights',
    ),
    readAll<{ id: string; account_id: string | null }>(
      (from, to) =>
        supabase.from('conversations').select('id, account_id').not('account_id', 'is', null).order('id').range(from, to),
      'Could not load insights',
    ),
    readAll<{ id: string; name: string }>(
      (from, to) => supabase.from('accounts').select('id, name').order('id').range(from, to),
      'Could not load insights',
    ),
    supabase.rpc('company_team'),
  ]);
  const emailOf = new Map((team ?? []).map((person) => [person.user_id, person.is_you ? 'you' : person.email]));

  // Which customers each insight draws on: its signals' calls, and who each was with.
  const accountName = new Map(accounts.map((account) => [account.id, account.name]));
  const customerOfCall = new Map(calls.map((call) => [call.id, call.account_id ? accountName.get(call.account_id) : undefined]));
  const customersOf = new Map<string, Set<string>>();

  const conversationOf = new Map(signals.map((row) => [row.id, row.conversation_id]));

  const support = new Map<string, { signals: number; conversations: number }>();
  for (const insight of insights) {
    const signalIds = evidence.filter((row) => row.insight_id === insight.id).map((r) => r.signal_id);
    const names = new Set(
      signalIds.flatMap((signalId) => {
        const name = customerOfCall.get(conversationOf.get(signalId) ?? '');
        return name ? [name] : [];
      }),
    );
    customersOf.set(insight.id, names);
    support.set(insight.id, {
      signals: signalIds.length,
      conversations: new Set(signalIds.map((id) => conversationOf.get(id)).filter(Boolean)).size,
    });
  }

  const matches = (insight: InsightRow, wanted: string | null) =>
    wanted === null || (wanted === 'mine' ? insight.assigned_to === user?.id : insight.status === wanted);
  const countOf = (wanted: string | null) => insights.filter((insight) => matches(insight, wanted)).length;
  const shown = insights.filter((insight) => matches(insight, status));
  const pipeline = insightPipeline({
    insights: insights.map((insight) => ({
      id: insight.id,
      status: insight.status,
      createdAt: insight.created_at,
      decidedAt: insight.decided_at,
    })),
    tickets: tickets.map((ticket) => ({ insightId: ticket.insight_id, createdAt: ticket.created_at })),
    customersOf,
  });
  const days = (value: number | null) => (value === null ? '—' : value < 1 ? 'same day' : `${Math.round(value)} day${Math.round(value) === 1 ? '' : 's'}`);

  return (
    <main>
      <h1>Insights</h1>
      <FindInsightsButton />
      {insights.length > 0 ? (
        <section aria-labelledby="pipeline-heading">
          <h2 id="pipeline-heading" className="visually-hidden">
            Where insights stand
          </h2>
          <div className="grid" style={{ marginTop: '1rem' }}>
            <div className="card">
              <span className="stat-value">{pipeline.proposed}</span>
              <span className="stat-label">waiting for a decision · typically decided in {days(pipeline.daysToDecide)}</span>
            </div>
            <div className="card">
              <span className="stat-value">{pipeline.approved}</span>
              <span className="stat-label">approved, not yet a ticket</span>
            </div>
            <div className="card">
              <span className="stat-value">{pipeline.ticketed}</span>
              <span className="stat-label">became tickets · typically {days(pipeline.daysToTicket)} after approval</span>
            </div>
            <div className="card">
              <span className="stat-value">{pipeline.dismissed}</span>
              <span className="stat-label">dismissed</span>
            </div>
          </div>
          {pipeline.customers.length > 0 ? (
            <p className="muted">
              Drawn most from:{' '}
              {pipeline.customers.map((customer, index) => (
                <span key={customer.name}>
                  {index > 0 ? ', ' : ''}
                  {customer.name} ({customer.insights})
                </span>
              ))}
            </p>
          ) : null}
        </section>
      ) : null}
      {insights.length > 0 ? (
        <nav className="status-tabs" aria-label="Filter by status">
          {FILTERS.map((filter) => (
            <Link
              key={filter.label}
              href={filter.status ? `/insights?status=${filter.status}` : '/insights'}
              aria-current={filter.status === status ? 'page' : undefined}
            >
              {filter.label} ({countOf(filter.status)})
            </Link>
          ))}
        </nav>
      ) : null}
      {insights.length > 0 && shown.length === 0 ? (
        <p className="muted">
          None {status === 'proposed' ? 'waiting for you' : status === 'mine' ? 'assigned to you' : `${status ?? ''}`}.
        </p>
      ) : null}
      {insights.length === 0 ? (
        <p className="muted">
          Nothing yet. Insights appear when the same finding shows up in more than one
          conversation.
        </p>
      ) : (
        <ul className="signals">
          {shown.map((insight) => {
            const counts = support.get(insight.id);
            return (
              <li key={insight.id} className="signal">
                <div>
                  <Link href={`/insights/${insight.id}`}>{insight.title}</Link>{' '}
                  <span className={`stage stage-${insight.status}`}>{STATUS[insight.status] ?? insight.status}</span>
                </div>
                <p className="muted">
                  {counts?.signals ?? 0} signals across {counts?.conversations ?? 0} meetings
                  {insight.assigned_to ? ` · owned by ${emailOf.get(insight.assigned_to) ?? 'a former member'}` : ''}
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
