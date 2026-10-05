import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireAdmin } from '@/lib/admin';
import { utc } from '@/lib/time';
import { Chrome } from '../../chrome';
import { SetPlan } from '../set-plan';
import { SetRole } from './set-role';

/**
 * One company, in full: where its plan stands, what it has used, who is in
 * it, and what has happened to it. From admin_company_detail(), which checks
 * the caller is an operator. No call content — to see a call, open a support
 * session from People, which is recorded.
 */
export const dynamic = 'force-dynamic';

interface Detail {
  company: {
    id: string;
    name: string;
    plan: string;
    created_at: string;
    closed_at: string | null;
    closed_reason: string | null;
    retention_days: number | null;
    signed_up_by: string | null;
  };
  subscription: {
    status: string;
    period_start: string;
    period_end: string | null;
    cancel_at_period_end: boolean;
    scheduled_plan: string | null;
  };
  usage: { meter: string; limit: number | null; used: number }[];
  members: { email: string; role: string; joined: string; last_sign_in: string | null }[];
  calls: { total: number; last_30d: number; last: string | null; erased: number };
  spend_30d: number;
  history: { kind: string; from: string | null; to: string | null; source: string; actor: string | null; at: string }[];
  requests: { email: string; role: string; created_at: string; resolution: string | null; note: string | null }[];
  exports: { email: string; conversations: number; requested_at: string }[];
}

const METER: Record<string, string> = {
  calls: 'Imported calls',
  extractions: 'Find insights in a call',
  pattern_runs: 'Look for patterns',
  questions: 'Questions to Ask',
  live_seconds: 'Live minutes',
};

function used(m: Detail['usage'][number]): string {
  const live = m.meter === 'live_seconds';
  const u = live ? Math.ceil(m.used / 60) : m.used;
  if (m.limit === null) return `${u} — no limit`;
  return `${u} of ${live ? Math.round(m.limit / 60) : m.limit}`;
}

function standing(d: Detail): string {
  const s = d.subscription;
  if (d.company.closed_at) return `closed ${utc(d.company.closed_at)}`;
  if (s.status === 'trialing') return `trial, ends ${s.period_end ? utc(s.period_end) : '—'}`;
  if (s.status === 'canceled') return 'no plan';
  if (s.cancel_at_period_end) return `cancels ${s.period_end ? utc(s.period_end) : ''}`;
  if (s.scheduled_plan) return `moves to ${s.scheduled_plan} ${s.period_end ? utc(s.period_end) : ''}`;
  return `active, period ends ${s.period_end ? utc(s.period_end) : '—'}`;
}

interface CriterionRow {
  engagement_type: string;
  version: number;
  key: string;
  label: string;
  definition: string;
  weight: number;
  created_at: string;
}

/** Each scorecard's newest version in full, and how many versions it has had. */
function scorecardsOf(rows: readonly CriterionRow[]) {
  const byName = new Map<string, { name: string; versions: Set<number>; newest: number; published: string; criteria: CriterionRow[] }>();
  for (const row of rows) {
    const seen = byName.get(row.engagement_type) ?? {
      name: row.engagement_type,
      versions: new Set<number>(),
      newest: row.version,
      published: row.created_at,
      criteria: [],
    };
    seen.versions.add(row.version);
    if (row.version === seen.newest) seen.criteria.push(row);
    byName.set(row.engagement_type, seen);
  }
  return [...byName.values()];
}

/** What admin_company_integrations returns: connections, counts and billing ids. */
interface Integrations {
  crm: { provider: string; account_ref: string; connected_at: string; last_error: string | null; notes: number } | null;
  tracker: { provider: string; target: string; connected_at: string } | null;
  calendars: number;
  emails_sent: number;
  billing: {
    provider: string;
    status: string;
    customer_id: string | null;
    subscription_id: string | null;
    period_end: string | null;
    cancel_at_period_end: boolean;
  } | null;
  last_stripe_event: { type: string; outcome: string; received_at: string } | null;
}

export default async function CompanyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const admin = await requireAdmin();
  const [{ data, error }, { data: people }, { data: roleChanges }, { data: criteria }, { data: agreements }, { data: integrationData }] = await Promise.all([
    admin.db.rpc('admin_company_detail', { p_company_id: id }),
    // The detail names members by address; changing a role needs their id.
    admin.db.rpc('admin_users'),
    admin.db
      .from('membership_role_changes')
      .select('id, email, from_role, to_role, changed_by, changed_at')
      .eq('company_id', id)
      .order('changed_at', { ascending: false })
      .limit(20),
    // The company's own scorecards (ADR 0016). Read as the operator, through
    // RLS; the console does not change them — that is the owner's job.
    admin.db
      .from('criteria_definitions')
      .select('engagement_type, version, key, label, definition, weight, position, created_at')
      .eq('company_id', id)
      .order('engagement_type')
      .order('version', { ascending: false })
      .order('position'),
    // Who has agreed, once, to tell everyone on every call they record (ADR 0020).
    admin.db
      .from('recording_agreements')
      .select('email, terms_version, surface, agreed_at')
      .eq('company_id', id)
      .order('agreed_at', { ascending: false }),
    // What it is connected to and how it pays: ids and counts, never a token.
    admin.db.rpc('admin_company_integrations', { p_company_id: id }),
  ]);
  const integrations = integrationData as unknown as Integrations | null;
  const agreementOf = new Map<string, { terms_version: string; surface: string; agreed_at: string }>();
  for (const row of agreements ?? []) if (!agreementOf.has(row.email.toLowerCase())) agreementOf.set(row.email.toLowerCase(), row);
  const scorecards = scorecardsOf(criteria ?? []);
  if (error?.code === '22023') notFound();
  const idOf = new Map(
    (people ?? []).filter((p) => p.company_id === id).map((p) => [p.email ?? '', p.user_id]),
  );
  const emailOf = new Map((people ?? []).map((p) => [p.user_id, p.email ?? '']));
  // A function's jsonb comes typed as Json; this is its shape.
  const d = data as unknown as Detail | null;
  if (!d) {
    return (
      <Chrome email={admin.email}>
        <p className="tag open">{error?.message ?? 'The company could not be read.'}</p>
      </Chrome>
    );
  }

  return (
    <Chrome email={admin.email}>
      <p>
        <Link className="link" href="/companies">
          ← Companies
        </Link>
      </p>
      <h1>{d.company.name}</h1>
      <p className="lede">
        <span className="tag">{d.company.plan}</span> {standing(d)} · created {utc(d.company.created_at)}
        {d.company.signed_up_by ? ` by ${d.company.signed_up_by} (self-serve)` : ''} · retention{' '}
        {d.company.retention_days ? `${d.company.retention_days} days` : 'unset'}
        {d.company.closed_reason ? ` · closed: ${d.company.closed_reason}` : ''}
      </p>

      {d.company.closed_at ? null : (
        <div className="row" style={{ alignItems: 'center', marginBottom: '1rem' }}>
          <div className="go">
            <SetPlan companyId={d.company.id} current={d.company.plan} />
          </div>
          <div className="go">
            <Link className="link" href={`/companies/${d.company.id}/close`}>
              Close this company…
            </Link>
          </div>
        </div>
      )}

      <div className="detail-grid">
        <section className="card">
          <h2 style={{ marginTop: 0 }}>This period</h2>
          <table tabIndex={0}>
            <tbody>
              {d.usage.map((m) => (
                <tr key={m.meter}>
                  <td>{METER[m.meter] ?? m.meter}</td>
                  <td className="num">{used(m)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted" style={{ marginBottom: 0 }}>
            Since {utc(d.subscription.period_start)}. Estimated AI spend, 30 days: $
            {Number(d.spend_30d).toFixed(2)}.
          </p>
        </section>

        <section className="card">
          <h2 style={{ marginTop: 0 }}>Billing</h2>
          {integrations?.billing?.provider === 'stripe' ? (
            <>
              <p>
                <span className="tag">Stripe</span> {integrations.billing.status}
                {integrations.billing.period_end
                  ? `, ${integrations.billing.cancel_at_period_end ? 'cancels' : 'renews'} ${utc(integrations.billing.period_end)}`
                  : ''}
                .
              </p>
              <p className="muted" style={{ marginBottom: 0 }}>
                Customer{' '}
                <a href={`https://dashboard.stripe.com/customers/${integrations.billing.customer_id ?? ''}`} target="_blank" rel="noreferrer">
                  {integrations.billing.customer_id}
                </a>
                . Closing the company or setting its plan here does not cancel this subscription: cancel it in Stripe.
              </p>
            </>
          ) : (
            <p style={{ marginBottom: 0 }}>
              Not paying through Stripe{integrations?.billing?.customer_id ? ` (was customer ${integrations.billing.customer_id})` : ''}.
            </p>
          )}
          {integrations?.last_stripe_event ? (
            <p className="muted" style={{ marginBottom: 0 }}>
              Last from Stripe: <code>{integrations.last_stripe_event.type}</code>, {integrations.last_stripe_event.outcome},{' '}
              {utc(integrations.last_stripe_event.received_at)}.
            </p>
          ) : null}
        </section>

        <section className="card">
          <h2 style={{ marginTop: 0 }}>Connected</h2>
          <ul style={{ marginBottom: 0 }}>
            <li>
              CRM:{' '}
              {integrations?.crm
                ? `HubSpot account ${integrations.crm.account_ref}, since ${utc(integrations.crm.connected_at)} · ${integrations.crm.notes} call${integrations.crm.notes === 1 ? '' : 's'} logged${integrations.crm.last_error ? ` · needs attention: ${integrations.crm.last_error}` : ''}`
                : 'none'}
            </li>
            <li>Tracker: {integrations?.tracker ? `${integrations.tracker.provider} ${integrations.tracker.target}` : 'none'}</li>
            <li>
              Calendars: {integrations?.calendars ?? 0} {integrations?.calendars === 1 ? 'person' : 'people'} connected
            </li>
            <li>Follow-up emails sent: {integrations?.emails_sent ?? 0}</li>
          </ul>
        </section>

        <section className="card">
          <h2 style={{ marginTop: 0 }}>Calls</h2>
          <p style={{ marginBottom: 0 }}>
            {d.calls.total} in total, {d.calls.last_30d} in the last 30 days · last imported{' '}
            {d.calls.last ? utc(d.calls.last) : 'never'} · {d.calls.erased} deleted
          </p>
        </section>

        <section className="card">
          <h2 style={{ marginTop: 0 }}>People ({d.members.length})</h2>
          {d.members.length === 0 ? (
            <p className="muted" style={{ marginBottom: 0 }}>Nobody.</p>
          ) : (
            <table tabIndex={0}>
              <tbody>
                {d.members.map((m) => (
                  <tr key={m.email}>
                    <td>{m.email}</td>
                    <td className="muted">{m.role}</td>
                    <td className="muted">{m.last_sign_in ? `seen ${utc(m.last_sign_in)}` : 'never signed in'}</td>
                    <td className="muted">
                      {(() => {
                        const agreement = agreementOf.get(m.email.toLowerCase());
                        return agreement
                          ? `agreed to record ${utc(agreement.agreed_at)} · Terms ${agreement.terms_version} · ${agreement.surface}`
                          : 'no recording agreement';
                      })()}
                    </td>
                    <td>
                      {d.company.closed_at || !idOf.get(m.email) ? null : (
                        <SetRole
                          companyId={d.company.id}
                          userId={idOf.get(m.email)!}
                          email={m.email}
                          to={m.role === 'owner' ? 'member' : 'owner'}
                        />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {(roleChanges ?? []).length > 0 ? (
            <details style={{ marginTop: '0.6rem' }}>
              <summary className="muted">Role changes</summary>
              <ul style={{ marginBottom: 0 }}>
                {(roleChanges ?? []).map((c) => (
                  <li key={c.id} className="muted">
                    {utc(c.changed_at)} — {c.email}: {c.from_role} → {c.to_role}, by{' '}
                    {c.changed_by ? (emailOf.get(c.changed_by) ?? 'a deleted account') : 'a deleted account'}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </section>

        <section className="card">
          <h2 style={{ marginTop: 0 }}>Plan history</h2>
          {d.history.length === 0 ? (
            <p className="muted" style={{ marginBottom: 0 }}>Nothing yet.</p>
          ) : (
            <ul style={{ marginBottom: 0 }}>
              {d.history.map((h) => (
                <li key={`${h.at}-${h.kind}`} className="muted">
                  {utc(h.at)} — {h.kind.replace(/_/g, ' ')}
                  {h.from || h.to ? ` (${h.from ?? '—'} → ${h.to ?? '—'})` : ''}, by{' '}
                  {h.source === 'system' ? 'the system' : (h.actor ?? h.source)}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card">
          <h2 style={{ marginTop: 0 }}>Teammate requests</h2>
          {d.requests.length === 0 ? (
            <p className="muted" style={{ marginBottom: 0 }}>None.</p>
          ) : (
            <ul style={{ marginBottom: 0 }}>
              {d.requests.map((r) => (
                <li key={`${r.email}-${r.created_at}`} className="muted">
                  {r.email} ({r.role}), {utc(r.created_at)} —{' '}
                  {r.resolution === 'added' ? 'added' : r.resolution === 'declined' ? `declined: ${r.note ?? ''}` : 'waiting'}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card">
          <h2 style={{ marginTop: 0 }}>Scorecards</h2>
          {scorecards.length === 0 ? (
            <p className="muted" style={{ marginBottom: 0 }}>None of its own; it scores with the templates.</p>
          ) : (
            <ul style={{ marginBottom: 0 }}>
              {scorecards.map((card) => (
                <li key={card.name}>
                  <details>
                    <summary>
                      {card.name} v{card.newest}{' '}
                      <span className="muted">
                        · {card.criteria.length} criteria · {card.versions.size} version
                        {card.versions.size === 1 ? '' : 's'} · {utc(card.published)}
                      </span>
                    </summary>
                    <ol>
                      {card.criteria.map((row) => (
                        <li key={row.key}>
                          <strong>{row.label}</strong> <span className="muted">weight {row.weight}</span>
                          <br />
                          <span className="muted">{row.definition}</span>
                        </li>
                      ))}
                    </ol>
                  </details>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card">
          <h2 style={{ marginTop: 0 }}>Exports</h2>
          {d.exports.length === 0 ? (
            <p className="muted" style={{ marginBottom: 0 }}>None.</p>
          ) : (
            <ul style={{ marginBottom: 0 }}>
              {d.exports.map((e) => (
                <li key={e.requested_at} className="muted">
                  {e.email}, {utc(e.requested_at)} — {e.conversations} calls
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </Chrome>
  );
}
