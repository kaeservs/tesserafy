import Link from 'next/link';
import { requireAdmin } from '@/lib/admin';
import { listCompanies } from '@/lib/companies';
import { utc } from '@/lib/time';
import { Chrome } from '../chrome';

/**
 * The tenants, and what is actually true about them.
 *
 * `plan` is a label somebody set by hand; there is no billing system behind
 * it, and the column header says so rather than letting a dashboard imply a
 * revenue number that nobody computed. Everything else here is counted.
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
  const { companies, error } = await listCompanies(admin.db);

  return (
    <Chrome email={admin.email}>
      <h1>Companies</h1>
      <p className="lede">
        One row per tenant. Spend is estimated from recorded token usage at published rates, not
        billed. Plan is a hand-set label — there is no billing system behind it.
      </p>

      {error ? <p className="tag open">{error}</p> : null}

      <table>
        <thead>
          <tr>
            <th>Company</th>
            <th>Plan (label)</th>
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
                  <span className="tag">{company.plan}</span>
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
