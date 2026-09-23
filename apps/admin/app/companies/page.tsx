import { requireAdmin } from '@/lib/admin';
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
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  return days === 0 ? 'today' : days === 1 ? 'yesterday' : `${days}d ago`;
}

export default async function Companies() {
  const admin = await requireAdmin();
  const { data, error } = await admin.db.rpc('admin_companies');
  const companies = data ?? [];

  return (
    <Chrome email={admin.email}>
      <h1>Companies</h1>
      <p className="lede">
        One row per tenant. Spend is estimated from recorded token usage at published rates, not
        billed. Plan is a hand-set label — there is no billing system behind it.
      </p>

      {error ? <p className="tag open">{error.message}</p> : null}

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
          </tr>
        </thead>
        <tbody>
          {companies.map((company) => (
            <tr key={company.company_id}>
              <td>{company.name}</td>
              <td>
                <span className="tag">{company.plan}</span>
              </td>
              <td className="num">{company.members}</td>
              <td className="num">{company.conversations}</td>
              <td className="num">{company.segments}</td>
              <td className="muted">{ago(company.last_activity)}</td>
              <td className="num">
                {company.failures_24h > 0 ? (
                  <span className="tag open">{company.failures_24h}</span>
                ) : (
                  <span className="muted">0</span>
                )}
              </td>
              <td className="num">${Number(company.spend_30d_usd).toFixed(2)}</td>
              <td className="num muted">
                {company.retention_days ? `${company.retention_days}d` : 'unset'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {companies.length === 0 && !error ? <p className="muted">No companies yet.</p> : null}
    </Chrome>
  );
}
