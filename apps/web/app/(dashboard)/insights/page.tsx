import Link from 'next/link';
import { FindInsightsButton } from '@/components/find-insights-button';
import { readAll } from '@tesserafy/db';
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
 */

interface InsightRow {
  id: string;
  title: string;
  summary: string;
  created_at: string;
  status: string;
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

export default async function InsightsPage() {
  const supabase = await createClient();

  // Every row, not the first thousand: the counts beside each insight are
  // its support, and a count computed from part of the evidence understates
  // exactly the insights that matter most. See readAll.
  const [insights, evidence, signals] = await Promise.all([
    readAll<InsightRow>(
      (from, to) =>
        supabase
          .from('insights')
          .select('id, title, summary, created_at, status')
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
  ]);

  const conversationOf = new Map(signals.map((row) => [row.id, row.conversation_id]));

  const support = new Map<string, { signals: number; conversations: number }>();
  for (const insight of insights) {
    const signalIds = evidence.filter((row) => row.insight_id === insight.id).map((r) => r.signal_id);
    support.set(insight.id, {
      signals: signalIds.length,
      conversations: new Set(signalIds.map((id) => conversationOf.get(id)).filter(Boolean)).size,
    });
  }

  return (
    <main>
      <h1>Insights</h1>
      <FindInsightsButton />
      {insights.length === 0 ? (
        <p className="muted">
          Nothing yet. Insights appear when the same finding shows up in more than one
          conversation.
        </p>
      ) : (
        <ul className="signals">
          {insights.map((insight) => {
            const counts = support.get(insight.id);
            return (
              <li key={insight.id} className="signal">
                <div>
                  <Link href={`/insights/${insight.id}`}>{insight.title}</Link>{' '}
                  <span className={`stage stage-${insight.status}`}>{STATUS[insight.status] ?? insight.status}</span>
                </div>
                <p className="muted">
                  {counts?.signals ?? 0} signals across {counts?.conversations ?? 0} meetings
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
