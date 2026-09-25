import Link from 'next/link';
import { requireAdmin } from '@/lib/admin';
import { listCompanies } from '@/lib/companies';
import { utc } from '@/lib/time';
import { Chrome } from '../chrome';
import { SetPlan } from './set-plan';
import { SignupSwitch } from './signup-switch';

/**
 * The tenants, and what is actually true about them.
 *
 * `plan` decides each company's monthly AI allowance, and can be set here —
 * but nothing is charged for it yet: payments do not exist, and plans are
 * free until they do. The lede says so rather than letting a dashboard imply
 * revenue nobody collected. Everything else here is counted.
 */
export const dynamic = 'force-dynamic';

function ago(iso: string | null): string {
  if (!iso) return 'never';
  // Clamped at zero. A timestamp can sit a moment in the future — the
  // server's clock against this one, or, in the support tool, the sign-in
  // this very command just performed — and an unclamped floor renders that
  // as "-1d ago", which reads like a bug in the data rather than in the
  // arithmetic.
  const days = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000));
  return days === 0 ? 'today' : days === 1 ? 'yesterday' : `${days}d ago`;
}

export default async function Companies() {
  const admin = await requireAdmin();
  const [{ companies, error }, { data: settings }] = await Promise.all([
    listCompanies(admin.db),
    admin.db.from('app_settings').select('signup_open, updated_at').maybeSingle(),
  ]);

  return (
    <Chrome email={admin.email}>
      <h1>Companies</h1>
      <p className="lede">
        One row per tenant. Spend is estimated from recorded token usage at published rates, not
        billed. Plan sets the monthly AI allowance and changes now when set here; nothing is
        charged for it until payments exist.
      </p>

      <SignupSwitch
        open={settings?.signup_open === true}
        changed={settings && settings.updated_at ? utc(settings.updated_at) : null}
      />

      {error ? <p className="tag open">{error}</p> : null}

      <table>
        <thead>
          <tr>
            <th>Company</th>
            <th>Plan</th>
            <th className="num">People</th>
            <th className="num">Calls</th>
            <th className="num">Segments</th>
            <th>Last call</th>
            <th className="num">Failures 24h</th>
            <th className="num">Spend 30d</th>
            <th className="num">Retention</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {companies.map((company) => (
            <tr key={company.companyId} className={company.closedAt ? 'muted' : undefined}>
              <td>{company.name}</td>
              <td>
                {company.closedAt ? (
                  <span className="tag" title={utc(company.closedAt)}>
                    closed
                  </span>
                ) : (
                  <SetPlan companyId={company.companyId} current={company.plan} />
                )}
              </td>
              <td className="num">{company.members}</td>
              <td className="num">{company.conversations}</td>
              <td className="num">{company.segments}</td>
              <td className="muted">{ago(company.lastActivity)}</td>
              <td className="num">
                {company.failures24h > 0 ? (
                  <span className="tag open">{company.failures24h}</span>
                ) : (
                  <span className="muted">0</span>
                )}
              </td>
              <td className="num">${company.spend30dUsd.toFixed(2)}</td>
              <td className="num muted">
                {company.retentionDays ? `${company.retentionDays}d` : 'unset'}
              </td>
              <td>
                {company.closedAt ? null : (
                  <Link className="link" href={`/companies/${company.companyId}/close`}>
                    Close…
                  </Link>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {companies.length === 0 && !error ? <p className="muted">No companies yet.</p> : null}
    </Chrome>
  );
}
