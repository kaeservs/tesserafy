import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireAdmin } from '@/lib/admin';
import { utc } from '@/lib/time';
import { Chrome } from '../../chrome';
import { SetPlan } from '../set-plan';

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

export default async function CompanyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const admin = await requireAdmin();
  const { data, error } = await admin.db.rpc('admin_company_detail', { p_company_id: id });
  if (error?.code === '22023') notFound();
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
          <table>
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
            <table>
              <tbody>
                {d.members.map((m) => (
                  <tr key={m.email}>
                    <td>{m.email}</td>
                    <td className="muted">{m.role}</td>
                    <td className="muted">{m.last_sign_in ? `seen ${utc(m.last_sign_in)}` : 'never signed in'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
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
