import Link from 'next/link';
import { requireAdmin } from '@/lib/admin';
import { utc } from '@/lib/time';
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

const PLAN_ORDER = ['trial', 'basic', 'pro', 'pilot', 'internal', 'none'];

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
  const { data, error } = await admin.db.rpc('admin_overview');
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

  const attention = [
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
        {o.failures_24h} failure{o.failures_24h === 1 ? '' : 's'} recorded in the last 24 hours — run{' '}
        <code>pnpm health</code>
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

      <section className="card">
        <h2 style={{ marginTop: 0 }}>Companies by plan</h2>
        <table>
          <tbody>
            {PLAN_ORDER.filter((plan) => (o.companies.by_plan[plan] ?? 0) > 0).map((plan) => (
              <tr key={plan}>
                <td>
                  <span className="tag">{plan}</span>
                </td>
                <td className="num">{o.companies.by_plan[plan]}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted" style={{ marginBottom: 0 }}>
          {o.companies.closed} closed. Payments are not live, so no plan is billed yet.
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
