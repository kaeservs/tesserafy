import { TableScroll } from '@/components/table-scroll';
import Link from 'next/link';
import { criteriaByOutcome, MIN_DECIDED, percent } from '@/lib/coaching';
import { loadCoachingCalls } from '@/lib/coaching-data';
import { criteriaTrend } from '@/lib/criteria-trend';
import { filterCalls, parseReportFilters, RANGES, reportQuery } from '@/lib/report-filters';
import { engagementLabel } from '@/lib/company';
import { ScoreTrend } from '@/components/score-trend';
import { buildReport, type Seller } from '@/lib/report';
import { speakerKey, talkBySeller } from '@/lib/talk';
import { GoalForm } from '@/components/goal-form';
import { createClient } from '@/lib/supabase/server';

export const metadata = { title: 'Reports · Tesserafy' };


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
export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [{ data: membership }, all, { data: team }, { data: accountRows }, { data: goalRows }, { data: ourRows }] = await Promise.all([
    supabase.from('company_members').select('role').eq('user_id', user?.id ?? '').limit(1).maybeSingle(),
    loadCoachingCalls(supabase),
    supabase.rpc('company_team'),
    supabase.from('accounts').select('id, name').order('name').limit(500),
    supabase.from('criterion_goals').select('engagement_type, criterion_key, target'),
    supabase.from('our_speakers').select('name'),
  ]);
  const isOwner = membership?.role === 'owner';
  const filters = parseReportFilters(params, { isOwner });
  const goalOf = new Map((goalRows ?? []).map((row) => [`${row.engagement_type}/${row.criterion_key}`, Number(row.target)]));
  const ours = new Set((ourRows ?? []).map((row) => speakerKey(row.name)));
  // One list of calls for every table on the page, and for its CSVs.
  const selected = filterCalls(all, filters, user?.id ?? null);
  const now = new Date();

  const report = buildReport(
    selected.map((call) => ({ date: call.date, addedBy: call.addedBy, score: call.score, criteria: [...call.criteria] })),
    now,
    filters.weeks,
  );
  // Company-wide unless filtered, so every member sees it: it ranks criteria, not people.
  const byOutcome = criteriaByOutcome(selected);
  const trends = criteriaTrend(selected, now, filters.weeks);
  // Who talked, per seller: only once someone has marked whose people are whose.
  const since = new Date(now.getTime() - filters.weeks * 7 * 86_400_000).toISOString();
  const { data: talkRows } = ours.size > 0 ? await supabase.rpc('conversation_talk', { p_since: since }) : { data: [] };
  const selectedIds = new Set(selected.map((call) => call.id));
  const talk = talkBySeller(
    (talkRows ?? [])
      .filter((row) => selectedIds.has(row.conversation_id))
      .map((row) => ({ conversationId: row.conversation_id, speaker: row.speaker, words: Number(row.words) })),
    ours,
    new Map(selected.map((call) => [call.id, call.addedBy])),
  );
  const email = new Map((team ?? []).map((person) => [person.user_id, person.email]));
  const sellers = isOwner ? report.sellers : report.sellers.filter((s) => s.addedBy === user?.id);
  const anyCalls = report.weeks.some((w) => w.calls > 0);
  const types = [...new Set(all.map((call) => call.engagementType))].sort();
  const csv = (table: string) => `/api/export/reports?${reportQuery(filters, { table })}`;

  return (
    <main>
      <h1>Reports</h1>
      <form method="get" action="/reports" className="filters" aria-label="What to report on">
        <div className="field">
          <label htmlFor="weeks">Period</label>
          <select id="weeks" name="weeks" defaultValue={String(filters.weeks)}>
            {Object.entries(RANGES).map(([weeks, label]) => (
              <option key={weeks} value={weeks}>
                {label}
              </option>
            ))}
          </select>
        </div>
        {types.length > 1 ? (
          <div className="field">
            <label htmlFor="type">Scorecard</label>
            <select id="type" name="type" defaultValue={filters.type ?? ''}>
              <option value="">Any</option>
              {types.map((type) => (
                <option key={type} value={type}>
                  {engagementLabel(type)}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        {(accountRows ?? []).length > 0 ? (
          <div className="field">
            <label htmlFor="account">Customer</label>
            <select id="account" name="account" defaultValue={filters.account ?? ''}>
              <option value="">Any</option>
              {(accountRows ?? []).map((row) => (
                <option key={row.id} value={row.id}>
                  {row.name}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        <div className="field">
          <label htmlFor="seller">Seller</label>
          <select id="seller" name="seller" defaultValue={filters.seller ?? ''}>
            <option value="">Everyone</option>
            <option value="mine">Only my calls</option>
            {isOwner
              ? (team ?? [])
                  .filter((person) => !person.is_you)
                  .map((person) => (
                    <option key={person.user_id} value={person.user_id}>
                      {person.email}
                    </option>
                  ))
              : null}
          </select>
        </div>
        <div className="toolbar filter-actions">
          <button type="submit">Show</button>
          {reportQuery(filters) ? <Link href="/reports">Clear</Link> : null}
        </div>
      </form>
      <p className="muted">
        {RANGES[filters.weeks]}, by the week each meeting took place{selected.length < all.length ? `, ${selected.length} of ${all.length} calls` : ''}.
        Scores are worked out from the quoted evidence on each call; a call where nothing has been heard yet is left out
        of the averages rather than counted as zero.
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
          <p className="muted" style={{ marginBottom: 0 }}>No calls in this period.</p>
        )}
        <p className="muted" style={{ marginBottom: 0, fontSize: '0.82rem' }}>
          <a href={csv('weeks')} download>
            Download as CSV
          </a>
        </p>
      </section>

      <section aria-labelledby="sellers-heading" className="card">
        <h2 id="sellers-heading" style={{ marginTop: 0 }}>
          {isOwner ? 'By seller' : 'Your calls'}
        </h2>
        {sellers.length === 0 ? (
          <p className="muted" style={{ marginBottom: 0 }}>
            {isOwner
              ? `No calls in the ${RANGES[filters.weeks].toLowerCase()}.`
              : `You have not added a call in the ${RANGES[filters.weeks].toLowerCase()}.`}
          </p>
        ) : (
          <TableScroll label="By seller">
            <table className="team">
              <thead>
                <tr>
                  <th>{isOwner ? 'Seller' : 'You'}</th>
                  <th>Calls</th>
                  <th>Average</th>
                  <th>Last 4 weeks</th>
                  <th>Talked</th>
                  <th>Most often missed</th>
                </tr>
              </thead>
              <tbody>
                {sellers.map((seller) => (
                  <tr key={seller.addedBy ?? 'unattributed'}>
                    <td>
                      {seller.addedBy === null ? (
                        <span className="muted">Unattributed — added before sellers were recorded</span>
                      ) : email.has(seller.addedBy) ? (
                        <Link href={`/reports/sellers/${seller.addedBy}`}>{email.get(seller.addedBy)}</Link>
                      ) : (
                        <span className="muted">a former member</span>
                      )}
                    </td>
                    <td className="when">
                      {seller.calls}
                      {seller.scored < seller.calls ? <span className="muted"> ({seller.scored} scored)</span> : null}
                    </td>
                    <td>{score(seller.average)}</td>
                    <td className="muted when">{change(seller)}</td>
                    <td className="when">
                      {seller.addedBy !== null && talk.has(seller.addedBy) ? (
                        <>
                          {Math.round(talk.get(seller.addedBy)!.share * 100)}%
                          <span className="muted"> of {talk.get(seller.addedBy)!.calls}</span>
                        </>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td className="muted">
                      {seller.mostMissed
                        ? `${seller.mostMissed.label} — confirmed on ${Math.round(seller.mostMissed.confirmedRate * 100)}%`
                        : 'needs three scored calls'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        )}
        {sellers.length > 0 ? (
          <p className="muted" style={{ fontSize: '0.82rem' }}>
            {ours.size === 0
              ? 'Talked — your side’s share of the words — appears once someone marks who is one of yours under Who talked on a call.'
              : 'Talked is your side’s share of the words, averaged over the calls where both sides are marked.'}
          </p>
        ) : null}
        {isOwner ? null : (
          <p className="muted" style={{ marginBottom: 0 }}>
            Owners see each seller&apos;s numbers; you see the company&apos;s trend and your own.
          </p>
        )}
        {sellers.length > 0 ? (
          <p className="muted" style={{ marginBottom: 0, fontSize: '0.82rem' }}>
            <a href={csv('sellers')} download>
              Download as CSV
            </a>
          </p>
        ) : null}
      </section>

      <section aria-labelledby="criteria-trend-heading" className="card">
        <h2 id="criteria-trend-heading" style={{ marginTop: 0 }}>
          Criteria over time
        </h2>
        {trends.length === 0 ? (
          <p className="muted" style={{ marginBottom: 0 }}>No scored calls in this period.</p>
        ) : (
          <>
            <TableScroll label="Criteria over time">
              <table className="team">
                <thead>
                  <tr>
                    <th scope="col">Criterion</th>
                    <th scope="col">Week by week</th>
                    <th scope="col">Last 4 weeks</th>
                    <th scope="col">Goal</th>
                  </tr>
                </thead>
                <tbody>
                  {trends.map((trend) => {
                    const recent = trend.points.slice(-4).filter((point) => point.rate !== null);
                    const recentRate =
                      recent.length === 0
                        ? null
                        : recent.reduce((sum, point) => sum + point.rate! * point.calls, 0) / recent.reduce((sum, point) => sum + point.calls, 0);
                    return (
                      <tr key={`${trend.engagementType}/${trend.key}`}>
                        <td>
                          {trend.label}
                          {types.length > 1 ? <span className="muted"> · {engagementLabel(trend.engagementType)}</span> : null}
                        </td>
                        <td>
                          <svg viewBox={`0 0 ${trend.points.length * 10} 24`} width={Math.max(80, trend.points.length * 10)} height={24} role="img" aria-label={`${trend.label}, week by week`}>
                            {trend.points.map((point, index) =>
                              point.rate === null ? null : (
                                <rect key={point.week} x={index * 10 + 1} y={24 - Math.max(1, point.rate * 22)} width={8} height={Math.max(1, point.rate * 22)} fill="currentColor" opacity={0.55}>
                                  <title>{`${point.week}: ${Math.round(point.rate * 100)}% of ${point.calls} call${point.calls === 1 ? '' : 's'}`}</title>
                                </rect>
                              ),
                            )}
                          </svg>
                        </td>
                        <td className="when">
                          {recentRate === null ? '—' : percent(recentRate)}
                          {trend.change !== null ? (
                            <span className="muted">
                              {' '}
                              {trend.change > 0 ? '↑' : trend.change < 0 ? '↓' : '→'} {Math.abs(trend.change)} pts on the 4 before
                            </span>
                          ) : null}
                        </td>
                        <td className="when">
                          {isOwner ? (
                            <GoalForm
                              engagementType={trend.engagementType}
                              criterionKey={trend.key}
                              label={trend.label}
                              target={goalOf.get(`${trend.engagementType}/${trend.key}`) ?? null}
                            />
                          ) : goalOf.has(`${trend.engagementType}/${trend.key}`) ? (
                            percent(goalOf.get(`${trend.engagementType}/${trend.key}`)!)
                          ) : (
                            <span className="muted">—</span>
                          )}
                          {goalOf.has(`${trend.engagementType}/${trend.key}`) && recentRate !== null ? (
                            <span className={recentRate >= goalOf.get(`${trend.engagementType}/${trend.key}`)! ? 'muted' : 'shortfall'}>
                              {recentRate >= goalOf.get(`${trend.engagementType}/${trend.key}`)! ? ' met' : ' below'}
                            </span>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </TableScroll>
            <p className="muted" style={{ marginBottom: 0, fontSize: '0.82rem' }}>
              Each bar is the share of that week&apos;s scored calls that met the criterion; hover one for the numbers. A week
              with no calls has no bar rather than a zero. {isOwner ? 'A goal is the share of calls you want it met on; the last four weeks are measured against it. ' : ''}
              <Link href="/examples">Examples</Link> shows what meeting each one sounds like on your calls.
            </p>
          </>
        )}
      </section>

      <section aria-labelledby="wins-heading" className="card">
        <h2 id="wins-heading" style={{ marginTop: 0 }}>
          What goes with a win
        </h2>
        {byOutcome.length === 0 ? (
          <p className="muted" style={{ marginBottom: 0 }}>
            Mark calls won or lost (Edit this call, on any call) and this shows which criteria are met more
            often on the calls you win. It needs {MIN_DECIDED} won and {MIN_DECIDED} lost scored calls on a
            scorecard.
          </p>
        ) : (
          <>
            {byOutcome.map((comparison) => (
              <div key={comparison.engagementType}>
                <h3>
                  {engagementLabel(comparison.engagementType)}{' '}
                  <span className="muted" style={{ fontWeight: 400 }}>
                    · {comparison.won} won, {comparison.lost} lost
                  </span>
                </h3>
                {comparison.enough ? (
                  <TableScroll label="What goes with a win">
                    <table className="team">
                      <thead>
                        <tr>
                          <th scope="col">Criterion</th>
                          <th scope="col">Met on won calls</th>
                          <th scope="col">Met on lost calls</th>
                        </tr>
                      </thead>
                      <tbody>
                        {comparison.criteria.map((row) => (
                          <tr key={row.key}>
                            <td>{row.label}</td>
                            <td>{percent(row.wonRate)}</td>
                            <td className="muted">{percent(row.lostRate)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </TableScroll>
                ) : (
                  <p className="muted">
                    Needs {MIN_DECIDED} won and {MIN_DECIDED} lost scored calls to compare.
                  </p>
                )}
              </div>
            ))}
            <p className="muted" style={{ marginBottom: 0, fontSize: '0.82rem' }}>
              Largest difference first. This shows what goes together, not what causes what: a criterion
              met more often on won calls may be a habit worth coaching, or a sign of a deal that was going
              well anyway. Open deals and calls with no outcome are left out.{' '}
              <a href={csv('wins')} download>
                Download as CSV
              </a>
            </p>
          </>
        )}
      </section>
    </main>
  );
}
