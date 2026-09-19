import Link from 'next/link';
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
}

interface EvidenceRow {
  insight_id: string;
  signal_id: string;
}

export default async function InsightsPage() {
  const supabase = await createClient();

  const [insightsResult, evidenceResult, signalsResult] = await Promise.all([
    supabase.from('insights').select('id, title, summary, created_at').order('created_at', { ascending: false }),
    supabase.from('insight_evidence').select('insight_id, signal_id'),
    supabase.from('signals').select('id, conversation_id'),
  ]);

  const failure = insightsResult.error ?? evidenceResult.error ?? signalsResult.error;
  if (failure) throw new Error(`Could not load insights: ${failure.message}`);

  const insights = (insightsResult.data ?? []) as InsightRow[];
  const evidence = (evidenceResult.data ?? []) as EvidenceRow[];
  const conversationOf = new Map(
    ((signalsResult.data ?? []) as { id: string; conversation_id: string }[]).map((row) => [
      row.id,
      row.conversation_id,
    ]),
  );

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
      {insights.length === 0 ? (
        <p className="muted">
          Nothing yet. Insights appear when the same finding shows up in more than one
          conversation — run <code>pnpm insights</code> once a few calls are imported.
        </p>
      ) : (
        <ul className="signals">
          {insights.map((insight) => {
            const counts = support.get(insight.id);
            return (
              <li key={insight.id} className="signal">
                <div>
                  <Link href={`/insights/${insight.id}`}>{insight.title}</Link>
                </div>
                <p className="muted" style={{ margin: '0.3rem 0 0' }}>
                  {counts?.signals ?? 0} signals across {counts?.conversations ?? 0} conversations
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
