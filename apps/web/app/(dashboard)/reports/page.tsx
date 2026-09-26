import { readAll } from '@tesserafy/db';
import { ScoreTrend } from '@/components/score-trend';
import { buildReport, WEEKS, type ReportCall, type Seller } from '@/lib/report';
import { scoreConversations, type ScorableConversation } from '@/lib/scorecard';
import { createClient } from '@/lib/supabase/server';

export const metadata = { title: 'Reports · Tesserafy' };

interface Row extends ScorableConversation {
  occurred_at: string | null;
  created_at: string;
  added_by: string | null;
}

function score(value: number | null): string {
  return value === null ? '—' : String(Math.round(value));
}

function change(seller: Seller): string {
  if (seller.recent === null) return '—';
  // Recent calls with nothing before them to compare against: say so,
  // rather than a dash that reads like "no calls".
  if (seller.previous === null) return `${Math.round(seller.recent)} (nothing in the 4 weeks before)`;
  const delta = Math.round(seller.recent - seller.previous);
  const arrow = delta > 0 ? '↑' : delta < 0 ? '↓' : '→';
  return `${arrow} ${Math.round(seller.recent)} (was ${Math.round(seller.previous)})`;
}

/**
 * How call quality is moving, and — for owners — by seller.
 *
 * Owners see every seller's numbers; a member sees the company's trend and
 * their own row. The owner decided this (2026-09-28): the breakdown is for
 * whoever manages the team, not for colleagues to rank each other. The calls
 * themselves are visible to every member, as they always were; what is
 * owner-only is this ranking of people.
 *
 * A call belongs to the account that added it. Calls added before that was
 * recorded are "unattributed" rather than guessed at.
 */
export default async function ReportsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [{ data: membership }, conversations, { data: team }] = await Promise.all([
    supabase.from('company_members').select('role').eq('user_id', user?.id ?? '').limit(1).maybeSingle(),
    readAll<Row>(
      (from, to) =>
        supabase
          .from('conversations')
          .select('id, occurred_at, created_at, engagement_type, criteria_version, added_by')
          .order('id')
          .range(from, to),
      'Could not load the report',
    ),
    supabase.rpc('company_team'),
  ]);
  const isOwner = membership?.role === 'owner';

  const scores = await scoreConversations(supabase, conversations);
  const calls: ReportCall[] = conversations.map((c) => {
    const card = scores.get(c.id)?.scorecard;
    const heard = card?.criteria.some((criterion) => criterion.status !== 'unobserved') ?? false;
    return {
      date: c.occurred_at ?? c.created_at,
      addedBy: c.added_by,
      score: card && heard ? card.score : null,
      criteria: (card?.criteria ?? []).map((criterion) => ({
        key: criterion.key,
        label: criterion.label,
        status: criterion.status,
      })),
    };
  });

  const report = buildReport(calls);
  const email = new Map((team ?? []).map((person) => [person.user_id, person.email]));
  const sellers = isOwner ? report.sellers : report.sellers.filter((s) => s.addedBy === user?.id);
  const anyCalls = report.weeks.some((w) => w.calls > 0);

  return (
    <main>
      <h1>Reports</h1>
      <p className="muted">
        The last {WEEKS} weeks, by the week each meeting took place. Scores are worked out from the
        quoted evidence on each call; a call where nothing has been heard yet is left out of the
        averages rather than counted as zero.
      </p>

      <section aria-labelledby="trend-heading" className="card">
        <h2 id="trend-heading" style={{ marginTop: 0 }}>
          Average score by week
        </h2>
        {anyCalls ? (
          <>
            <ScoreTrend weeks={report.weeks} />
            <p className="muted" style={{ marginBottom: 0, fontSize: '0.82rem' }}>
              The small number under each week is how many calls it had. Hover a point for its
              average and how many scored calls it rests on.
            </p>
          </>
        ) : (
          <p className="muted" style={{ marginBottom: 0 }}>No calls in the last {WEEKS} weeks yet.</p>
        )}
      </section>

      <section aria-labelledby="sellers-heading" className="card">
        <h2 id="sellers-heading" style={{ marginTop: 0 }}>
          {isOwner ? 'By seller' : 'Your calls'}
        </h2>
        {sellers.length === 0 ? (
          <p className="muted" style={{ marginBottom: 0 }}>
            {isOwner ? 'No calls in the last twelve weeks.' : 'You have not added a call in the last twelve weeks.'}
          </p>
        ) : (
          <table className="team">
            <thead>
              <tr>
                <th>{isOwner ? 'Seller' : 'You'}</th>
                <th>Calls</th>
                <th>Average</th>
                <th>Last 4 weeks</th>
                <th>Most often missed</th>
              </tr>
            </thead>
            <tbody>
              {sellers.map((seller) => (
                <tr key={seller.addedBy ?? 'unattributed'}>
                  <td>
                    {seller.addedBy === null ? (
                      <span className="muted">Unattributed — added before sellers were recorded</span>
                    ) : (
                      (email.get(seller.addedBy) ?? <span className="muted">a former member</span>)
                    )}
                  </td>
                  <td className="when">
                    {seller.calls}
                    {seller.scored < seller.calls ? <span className="muted"> ({seller.scored} scored)</span> : null}
                  </td>
                  <td>{score(seller.average)}</td>
                  <td className="muted when">{change(seller)}</td>
                  <td className="muted">
                    {seller.mostMissed
                      ? `${seller.mostMissed.label} — confirmed on ${Math.round(seller.mostMissed.confirmedRate * 100)}%`
                      : 'needs three scored calls'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {isOwner ? null : (
          <p className="muted" style={{ marginBottom: 0 }}>
            Owners see each seller&apos;s numbers; you see the company&apos;s trend and your own.
          </p>
        )}
      </section>
    </main>
  );
}
