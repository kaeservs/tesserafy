import Link from 'next/link';
import { requireAdmin } from '@/lib/admin';
import { utc } from '@/lib/time';
import { behind, newestOverlayVersion } from '@/lib/overlay-release';
import { Chrome } from './chrome';

/**
 * The platform at a glance — the console's landing page.
 *
 * What needs a person comes first: owners waiting on an answer, onboarding
 * that stopped part-way, failures, trials about to end. Then the shape of
 * things: companies by plan, activity, estimated AI spend. All of it from
 * admin_overview(), which checks the caller is an operator; nothing here is
 * call content.
 */
export const dynamic = 'force-dynamic';

interface Overview {
  companies: { open: number; closed: number; by_plan: Record<string, number> };
  trials_ending: { company_id: string; name: string; ends: string }[];
  changes_pending: { company_id: string; name: string; plan: string; ends: string; change: string }[];
  activity: { calls_7d: number; calls_30d: number; people: number; people_in_a_company: number; active_7d: number };
  spend: { usd_7d: number; usd_30d: number };
  failures_24h: number;
  waiting: { requests: number; unfinished_onboarding: number };
  signup_open: boolean;
}

/**
 * Open companies per plan, in the catalogue's order. A plan the catalogue no
 * longer has still shows, last, under its id: a company on it is still a company.
 */
function byPlan(
  plans: readonly { id: string; name: string }[],
  counts: Record<string, number>,
): { id: string; name: string; count: number }[] {
  const known = new Set(plans.map((plan) => plan.id));
  return [...plans, ...Object.keys(counts).filter((id) => !known.has(id)).map((id) => ({ id, name: id }))]
    .map((plan) => ({ ...plan, count: counts[plan.id] ?? 0 }))
    .filter((plan) => plan.count > 0);
}

function Stat({ value, label }: { value: string | number; label: string }) {
  return (
    <div className="card stat">
      <div className="stat-value">{value}</div>
      <div className="muted">{label}</div>
    </div>
  );
}

export default async function OverviewPage() {
  const admin = await requireAdmin();
  const [{ data, error }, { data: deletionRequests }, { data: week }, { data: seen }, newest, { data: planRows }] = await Promise.all([
    admin.db.rpc('admin_overview'),
    admin.db
      .from('account_deletion_requests')
      .select('user_id, requested_at')
      .is('resolved_at', null)
      .order('requested_at'),
    // The Cluely-style features over the last week, every company together.
    admin.db.rpc('admin_feature_adoption', { p_days: 7 }),
    admin.db.rpc('admin_overlay_seen'),
    newestOverlayVersion(),
    // The catalogue's order and names for "Companies by plan": every plan in it, Free and Incognito included.
    admin.db.from('plans').select('id, name').order('rank'),
  ]);
  const overlays = seen ?? [];
  const overlaysBehind = overlays.filter((row) => behind(row.version, newest)).length;
  // Open companies only, as Adoption shows by default: closed and test companies are not usage.
  const weekRows = (week ?? []).filter((row) => (row.closed_at as string | null) === null);
  const sum = (key: 'live_calls' | 'overlay_help' | 'questions' | 'follow_ups') =>
    weekRows.reduce((total, row) => total + Number(row[key]), 0);
  const overlayCompanies = weekRows.filter((row) => Number(row.live_calls) > 0 || Number(row.overlay_help) > 0).length;
  const asked = deletionRequests ?? [];
  // A function's jsonb comes typed as Json; this is its shape.
  const o = data as unknown as Overview | null;

  if (!o) {
    return (
      <Chrome email={admin.email}>
        <h1>Overview</h1>
        <p className="tag open">{error?.message ?? 'The overview could not be read.'}</p>
      </Chrome>
    );
  }

  // The oldest request sets the clock: the page promised deletion within 30 days.
  const oldestDays =
    asked.length > 0
      ? Math.floor((Date.now() - new Date(asked[0]!.requested_at).getTime()) / 86_400_000)
      : 0;

  const attention = [
    asked.length > 0 && (
      <li key="deletions">
        <Link
          className="link"
          href={`/people/delete?requested=1&ids=${asked.map((r) => r.user_id).join(',')}`}
        >
          {asked.length} {asked.length === 1 ? 'person has' : 'people have'} asked for their account
          to be deleted
        </Link>{' '}
        — the oldest {oldestDays === 0 ? 'today' : `${oldestDays} day${oldestDays === 1 ? '' : 's'} ago`}; they
        were promised within 30 days
      </li>
    ),
    o.waiting.requests > 0 && (
      <li key="requests">
        <Link className="link" href="/onboard">
          {o.waiting.requests} owner request{o.waiting.requests === 1 ? '' : 's'}
        </Link>{' '}
        waiting to be added or declined
      </li>
    ),
    o.waiting.unfinished_onboarding > 0 && (
      <li key="onboarding">
        <Link className="link" href="/onboard">
          {o.waiting.unfinished_onboarding} onboarding attempt{o.waiting.unfinished_onboarding === 1 ? '' : 's'}
        </Link>{' '}
        that did not finish
      </li>
    ),
    o.failures_24h > 0 && (
      <li key="failures">
        <Link className="link" href="/failures">
          {o.failures_24h} failure{o.failures_24h === 1 ? '' : 's'}
        </Link>{' '}
        recorded in the last 24 hours
      </li>
    ),
  ].filter(Boolean);

  return (
    <Chrome email={admin.email}>
      <h1>Overview</h1>
      <section className="card">
        <h2 style={{ marginTop: 0 }}>Needs you</h2>
        {attention.length > 0 ? <ul>{attention}</ul> : <p className="muted">Nothing is waiting on an operator.</p>}
        <p className="muted" style={{ marginBottom: 0 }}>
          Self-serve sign-up is <strong>{o.signup_open ? 'open' : 'closed'}</strong> —{' '}
          <Link className="link" href="/companies">
            change it on Companies
          </Link>
          .
        </p>
      </section>

      <div className="stats">
        <Stat value={o.companies.open} label="open companies" />
        <Stat value={o.activity.calls_7d} label={`calls imported this week (${o.activity.calls_30d} in 30 days)`} />
        <Stat value={o.activity.active_7d} label={`people signed in this week, of ${o.activity.people_in_a_company} in a company`} />
        <Stat value={`$${Number(o.spend.usd_7d).toFixed(2)}`} label={`AI spend this week, estimated ($${Number(o.spend.usd_30d).toFixed(2)} in 30 days)`} />
      </div>

      <section className="card" aria-labelledby="overlay-week">
        <h2 id="overlay-week" style={{ marginTop: 0 }}>
          The overlay this week
        </h2>
        <div className="stats" style={{ margin: 0 }}>
          <div>
            <div className="stat-value">{overlayCompanies}</div>
            <div className="muted">companies used it</div>
          </div>
          <div>
            <div className="stat-value">{sum('live_calls')}</div>
            <div className="muted">live calls</div>
          </div>
          <div>
            <div className="stat-value">{sum('overlay_help')}</div>
            <div className="muted">times its help was asked for</div>
          </div>
          <div>
            <div className="stat-value">{sum('questions')}</div>
            <div className="muted">questions to Ask</div>
          </div>
          <div>
            <div className="stat-value">{sum('follow_ups')}</div>
            <div className="muted">follow-up emails drafted</div>
          </div>
        </div>
        <p className="muted" style={{ marginBottom: 0 }}>
          Every company, the last 7 days. <Link className="link" href="/adoption">By company</Link>
        </p>
        <p className="muted" style={{ marginBottom: 0 }}>
          {overlays.length} {overlays.length === 1 ? 'person has' : 'people have'} reported a version
          {newest ? (
            <>
              {' '}· newest release {newest} ·{' '}
              <span className={`tag${overlaysBehind > 0 ? ' open' : ' admin'}`}>
                {overlaysBehind > 0 ? `${overlaysBehind} behind` : 'all up to date'}
              </span>
            </>
          ) : null}{' '}
          <Link className="link" href="/overlays">
            Who runs which
          </Link>
        </p>
      </section>

      <section className="card">
        <h2 style={{ marginTop: 0 }}>Companies by plan</h2>
        <table tabIndex={0}>
          <tbody>
            {byPlan(planRows ?? [], o.companies.by_plan).map((plan) => (
              <tr key={plan.id}>
                <td>
                  <span className="tag">{plan.name}</span>
                </td>
                <td className="num">{plan.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted" style={{ marginBottom: 0 }}>
          {o.companies.closed} closed. Whether plans are billed:{' '}
          <Link className="link" href="/payments">
            Payments
          </Link>
          .
        </p>
      </section>

      <section className="card">
        <h2 style={{ marginTop: 0 }}>Coming up</h2>
        {o.trials_ending.length === 0 && o.changes_pending.length === 0 ? (
          <p className="muted" style={{ marginBottom: 0 }}>
            No trial ends this week, and no plan is waiting to change.
          </p>
        ) : (
          <ul style={{ marginBottom: 0 }}>
            {o.trials_ending.map((t) => (
              <li key={`t-${t.company_id}`}>
                <Link className="link" href={`/companies/${t.company_id}`}>
                  {t.name}
                </Link>
                : trial ends {utc(t.ends)}
              </li>
            ))}
            {o.changes_pending.map((c) => (
              <li key={`c-${c.company_id}`}>
                <Link className="link" href={`/companies/${c.company_id}`}>
                  {c.name}
                </Link>
                : {c.plan} {c.change} on {utc(c.ends)}
              </li>
            ))}
          </ul>
        )}
      </section>
    </Chrome>
  );
}
