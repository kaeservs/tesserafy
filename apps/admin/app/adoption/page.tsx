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

const FEATURE_DAYS = 90;

/** The features a company might use, as admin_feature_adoption names them. */
const FEATURES = [
  { key: 'calls', label: 'Calls' },
  { key: 'preps', label: 'Call preps' },
  { key: 'examples', label: 'Examples' },
  { key: 'goals', label: 'Goals set' },
  { key: 'coaching', label: 'Coaching' },
  { key: 'corrections', label: 'Score corrections' },
  { key: 'feedback', label: 'Feedback' },
  { key: 'speakers_marked', label: 'Speakers marked' },
  { key: 'sample_call', label: 'Tried the sample' },
] as const;

export default async function Adoption({ searchParams }: { searchParams: Promise<{ all?: string }> }) {
  const { all } = await searchParams;
  const admin = await requireAdmin();
  const [{ data, error }, { data: weeks }, { data: featureRows, error: featureError }] = await Promise.all([
    admin.db.rpc('admin_adoption'),
    admin.db.rpc('admin_activity_weeks', { p_weeks: 12 }),
    admin.db.rpc('admin_feature_adoption', { p_days: FEATURE_DAYS }),
  ]);
  // Which features each company uses: counts only, no content (the function says why).
  const features = (featureRows ?? [])
    .filter((row) => all === '1' || (row.closed_at as string | null) === null)
    .map((row) => ({
      companyId: row.company_id,
      name: row.name,
      counts: FEATURES.map((feature) => (feature.key === 'sample_call' ? (row.sample_call ? 1 : 0) : Number(row[feature.key]))),
    }));
  const using = FEATURES.map((_, index) => features.filter((row) => row.counts[index]! > 0).length);
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

      <table tabIndex={0}>
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
      <table tabIndex={0}>
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
      <table tabIndex={0}>
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
      <table tabIndex={0}>
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

      <h2>What they use, last {FEATURE_DAYS} days</h2>
      <p className="muted">
        How many of each feature every company used. Goals and marked speakers are what is set now; the rest happened in the
        window. Counts only: the console does not read what is in them.
      </p>
      {featureError ? <p className="tag open">{featureError.message}</p> : null}
      <p>
        {FEATURES.map((feature, index) => (
          <span key={feature.key} style={{ marginRight: '1rem' }}>
            {feature.label}: <strong>{using[index]}</strong>
            <span className="muted"> of {features.length}</span>
          </span>
        ))}
      </p>
      <table tabIndex={0}>
        <thead>
          <tr>
            <th>Company</th>
            {FEATURES.map((feature) => (
              <th key={feature.key} className="num">
                {feature.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {features.map((row) => (
            <tr key={row.companyId}>
              <td>
                <Link className="link" href={`/companies/${row.companyId}`}>
                  {row.name}
                </Link>
              </td>
              {row.counts.map((count, index) => (
                <td key={FEATURES[index]!.key} className={`num${count === 0 ? ' muted' : ''}`}>
                  {FEATURES[index]!.key === 'sample_call' ? (count ? 'yes' : '—') : count || '—'}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </Chrome>
  );
}
