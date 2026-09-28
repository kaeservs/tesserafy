import Link from 'next/link';
import { adoptionCohort, adoptionFunnel, adoptionStage, cohorts, weeklyActive, type AdoptionRow } from '@tesserafy/db';
import { requireAdmin } from '@/lib/admin';
import { ago, utc } from '@/lib/time';
import { Chrome } from '../chrome';

/**
 * Are companies getting anywhere: created, first call, first insight, first
 * ticket — how many reach each step, and how long it takes them.
 *
 * Open customer companies by default. Closed ones are the record of what was
 * erased (every synthetic test company so far), and 'internal' is ours; both
 * would flatter or muddy the numbers, so they are in only when asked for.
 * Dates and counts only — nothing of any call.
 */
export const dynamic = 'force-dynamic';

function days(value: number | null): string {
  if (value === null) return '—';
  if (value < 1) return 'same day';
  return `${Math.round(value)}d`;
}

export default async function Adoption({ searchParams }: { searchParams: Promise<{ all?: string }> }) {
  const { all } = await searchParams;
  const admin = await requireAdmin();
  const [{ data, error }, { data: weeks }] = await Promise.all([
    admin.db.rpc('admin_adoption'),
    admin.db.rpc('admin_activity_weeks', { p_weeks: 12 }),
  ]);
  const rows: AdoptionRow[] = (data ?? []).map((row) => ({
    companyId: row.company_id,
    name: row.name,
    plan: row.plan,
    selfServe: row.self_serve,
    createdAt: row.created_at,
    // The generated types cannot say a returned column is nullable; these are.
    closedAt: (row.closed_at as string | null) ?? null,
    firstCallAt: (row.first_call_at as string | null) ?? null,
    firstInsightAt: (row.first_insight_at as string | null) ?? null,
    firstTicketAt: (row.first_ticket_at as string | null) ?? null,
    calls: Number(row.calls),
  }));
  const everything = all === '1';
  const cohort = adoptionCohort(rows, { includeClosed: everything, includeInternal: everything });
  const funnel = adoptionFunnel(cohort);
  // Coming back: the same companies as the funnel, active meaning they added
  // or opened a call that week.
  const inCohort = new Set(cohort.map((row) => row.companyId));
  const activity = (weeks ?? [])
    .filter((row) => inCohort.has(row.company_id))
    .map((row) => ({ companyId: row.company_id, week: row.week }));
  const now = new Date();
  const active = weeklyActive(activity, cohort, now, 12);
  const retention = cohorts(activity, cohort, now, 8).slice(0, 12);
  const peak = Math.max(1, ...active.map((week) => week.existing));

  return (
    <Chrome email={admin.email}>
      <h1>Adoption</h1>
      <p className="lede">
        From a company existing to its first ticket. {cohort.length} compan{cohort.length === 1 ? 'y' : 'ies'}
        {everything ? ', closed and internal included' : ', open customers only'}.{' '}
        <Link className="link" href={everything ? '/adoption' : '/adoption?all=1'}>
          {everything ? 'Open customers only' : 'Include closed and internal'}
        </Link>
      </p>
      {error ? <p className="tag open">{error.message}</p> : null}

      <table>
        <thead>
          <tr>
            <th>Step</th>
            <th className="num">Companies</th>
            <th className="num">Of those created</th>
            <th className="num">Median time to get there</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {funnel.map((step) => (
            <tr key={step.label}>
              <td>{step.label}</td>
              <td className="num">{step.companies}</td>
              <td className="num">{Math.round(step.share * 100)}%</td>
              <td className="num">{step.label === 'Company created' ? '' : days(step.medianDays)}</td>
              <td style={{ width: '30%' }}>
                <div style={{ background: 'currentColor', opacity: 0.35, height: '0.6rem', width: `${step.share * 100}%` }} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>Coming back</h2>
      <p className="muted">
        A company is active in a week if someone in it added or opened a call. Support sessions do not count.
      </p>
      <table>
        <thead>
          <tr>
            <th>Week of</th>
            <th className="num">Active</th>
            <th className="num">Existing</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {active.map((week) => (
            <tr key={week.week}>
              <td>{week.week}</td>
              <td className="num">{week.active}</td>
              <td className="num muted">{week.existing}</td>
              <td style={{ width: '35%' }}>
                <div style={{ background: 'currentColor', opacity: 0.35, height: '0.6rem', width: `${(week.active / peak) * 100}%` }} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3>By the week they started</h3>
      <p className="muted">Of the companies made each week, the share active in each week after it.</p>
      <table>
        <thead>
          <tr>
            <th>Started</th>
            <th className="num">Companies</th>
            {Array.from({ length: 8 }, (_, index) => (
              <th key={index} className="num">
                +{index + 1}w
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {retention.map((row) => (
            <tr key={row.week}>
              <td>{row.week}</td>
              <td className="num">{row.size}</td>
              {row.retained.map((share, index) => (
                <td key={index} className="num">
                  {share === null ? '' : `${Math.round(share * 100)}%`}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      <h2>Companies</h2>
      <table>
        <thead>
          <tr>
            <th>Company</th>
            <th>Plan</th>
            <th>How it started</th>
            <th>Created</th>
            <th>Got to</th>
            <th className="num">Calls</th>
            <th>First call</th>
            <th>First insight</th>
            <th>First ticket</th>
          </tr>
        </thead>
        <tbody>
          {cohort.map((row) => (
            <tr key={row.companyId} className={row.closedAt ? 'muted' : undefined}>
              <td>
                <Link className="link" href={`/companies/${row.companyId}`}>
                  {row.name}
                </Link>
              </td>
              <td>
                <span className="tag">{row.closedAt ? 'closed' : row.plan}</span>
              </td>
              <td className="muted">{row.selfServe ? 'signed up' : 'provisioned'}</td>
              <td className="muted" title={utc(row.createdAt)}>
                {ago(row.createdAt)}
              </td>
              <td>{adoptionStage(row)}</td>
              <td className="num">{row.calls}</td>
              <td className="muted">{row.firstCallAt ? utc(row.firstCallAt).slice(0, 10) : '—'}</td>
              <td className="muted">{row.firstInsightAt ? utc(row.firstInsightAt).slice(0, 10) : '—'}</td>
              <td className="muted">{row.firstTicketAt ? utc(row.firstTicketAt).slice(0, 10) : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {cohort.length === 0 && !error ? <p className="muted">No companies in this view.</p> : null}
    </Chrome>
  );
}
