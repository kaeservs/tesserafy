import Link from 'next/link';
import { byAttention, FAILING_AT, NEAR_LIMIT, NOT_STARTED_AFTER_DAYS, QUIET_AFTER_DAYS, type HealthRow } from '@tesserafy/db';
import { requireAdmin } from '@/lib/admin';
import { ago } from '@/lib/time';
import { Chrome } from '../chrome';

/**
 * Which companies need someone today.
 *
 * Four blunt flags from what is already recorded — never started, gone quiet,
 * nearly out of their plan, failing — and the companies with the most first.
 * Open customer companies only; closed ones are the record of an erasure and
 * internal is ours. Counts and dates, nothing of any call.
 */
export const dynamic = 'force-dynamic';

const FLAG_HELP: Record<string, string> = {
  'not started': `no call ${NOT_STARTED_AFTER_DAYS}+ days after it was made`,
  quiet: `no call for ${QUIET_AFTER_DAYS}+ days`,
  'near its limit': `${Math.round(NEAR_LIMIT * 100)}%+ of a monthly allowance used — a conversation about upgrading`,
  failing: `${FAILING_AT}+ recorded failures this week — see Failures`,
};

function usage(row: HealthRow): string {
  return row.usage
    .filter((meter) => meter.limit !== null && meter.limit > 0)
    .map((meter) => {
      const live = meter.meter === 'live';
      const used = live ? Math.ceil(meter.used / 60) : meter.used;
      const limit = live ? Math.round((meter.limit ?? 0) / 60) : meter.limit;
      return `${meter.meter} ${used}/${limit}`;
    })
    .join(' · ');
}

export default async function Health({ searchParams }: { searchParams: Promise<{ all?: string }> }) {
  const { all } = await searchParams;
  const admin = await requireAdmin();
  const { data, error } = await admin.db.rpc('admin_company_health');
  const everything = all === '1';
  const now = new Date();
  // Nullable in fact; the generated types cannot say so for a returned column.
  const rows: HealthRow[] = (data ?? [])
    .filter((row) => everything || ((row.closed_at as string | null) === null && row.plan !== 'internal'))
    .map((row) => ({
      companyId: row.company_id,
      name: row.name,
      plan: row.plan,
      createdAt: row.created_at,
      closedAt: (row.closed_at as string | null) ?? null,
      members: Number(row.members),
      calls7d: Number(row.calls_7d),
      calls30d: Number(row.calls_30d),
      views7d: Number(row.views_7d),
      lastCallAt: (row.last_call_at as string | null) ?? null,
      lastViewAt: (row.last_view_at as string | null) ?? null,
      failures7d: Number(row.failures_7d),
      usage: [
        { meter: 'calls', used: Number(row.calls_used), limit: (row.calls_limit as number | null) ?? null },
        { meter: 'insight reads', used: Number(row.extractions_used), limit: (row.extractions_limit as number | null) ?? null },
        { meter: 'live', used: Number(row.live_used_seconds), limit: (row.live_limit_seconds as number | null) ?? null },
      ],
      periodEnd: (row.period_end as string | null) ?? null,
    }));
  const sorted = byAttention(rows, now);
  const needing = sorted.filter((row) => row.flags.length > 0).length;

  return (
    <Chrome email={admin.email}>
      <h1>Account health</h1>
      <p className="lede">
        {needing === 0
          ? `Nothing needs anyone today across ${sorted.length} compan${sorted.length === 1 ? 'y' : 'ies'}.`
          : `${needing} of ${sorted.length} compan${sorted.length === 1 ? 'y needs' : 'ies need'} someone, first below.`}{' '}
        <Link className="link" href={everything ? '/health' : '/health?all=1'}>
          {everything ? 'Open customers only' : 'Include closed and internal'}
        </Link>
      </p>
      {error ? <p className="tag open">{error.message}</p> : null}
      <p className="muted">
        {Object.entries(FLAG_HELP).map(([flag, help]) => (
          <span key={flag} style={{ marginRight: '1rem' }}>
            <span className="tag open">{flag}</span> {help}
          </span>
        ))}
      </p>

      <table tabIndex={0}>
        <thead>
          <tr>
            <th>Company</th>
            <th>Needs</th>
            <th>Plan</th>
            <th className="num">People</th>
            <th className="num">Calls 7d / 30d</th>
            <th className="num">Opened 7d</th>
            <th>Last call</th>
            <th>This period</th>
            <th className="num">Failures 7d</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => (
            <tr key={row.companyId} className={row.closedAt ? 'muted' : undefined}>
              <td>
                <Link className="link" href={`/companies/${row.companyId}`}>
                  {row.name}
                </Link>
              </td>
              <td>
                {row.flags.length === 0 ? (
                  <span className="muted">—</span>
                ) : (
                  row.flags.map((flag) => (
                    <span key={flag} className="tag open" style={{ marginRight: 4 }}>
                      {flag}
                    </span>
                  ))
                )}
              </td>
              <td>
                <span className="tag">{row.closedAt ? 'closed' : row.plan}</span>
              </td>
              <td className="num">{row.members}</td>
              <td className="num">
                {row.calls7d} / {row.calls30d}
              </td>
              <td className="num">{row.views7d}</td>
              <td className="muted">{ago(row.lastCallAt)}</td>
              <td className="muted">{usage(row) || 'unlimited'}</td>
              <td className="num">{row.failures7d > 0 ? <span className="tag open">{row.failures7d}</span> : <span className="muted">0</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {sorted.length === 0 && !error ? <p className="muted">No companies in this view.</p> : null}
    </Chrome>
  );
}
