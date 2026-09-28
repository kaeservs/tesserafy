import { spendByDetector, spendByWeek, type SpendRow } from '@tesserafy/db';
import { requireAdmin } from '@/lib/admin';
import { Chrome } from '../chrome';

/**
 * What the AI costs, week by week, and what spends it.
 *
 * Estimated from the token usage every model call records, at published
 * rates (private.usage_usd) — not a bill. By tier, because a change in one
 * (ADR 0014 moved T3 to Sonnet) should show as a change in one line, and by
 * detector, because a prompt version is what a cost change is traced to.
 */
export const dynamic = 'force-dynamic';

const WEEKS = 12;
const TIERS = ['t1', 't2', 't3'] as const;
const TIER_LABEL: Record<string, string> = { t1: 'T1 scoring', t2: 'T2 suggestions', t3: 'T3 extraction' };

function usd(value: number): string {
  return value < 0.01 && value > 0 ? '<$0.01' : `$${value.toFixed(2)}`;
}

export default async function Spend() {
  const admin = await requireAdmin();
  const { data, error } = await admin.db.rpc('admin_spend_by_week', { p_weeks: WEEKS });
  const rows: SpendRow[] = (data ?? []).map((row) => ({
    week: row.week,
    tier: row.tier,
    model: row.model,
    detector: row.detector,
    calls: Number(row.calls),
    usd: Number(row.usd),
  }));
  const weeks = spendByWeek(rows, new Date(), WEEKS);
  const peak = Math.max(0.01, ...weeks.map((week) => week.usd));
  const total = weeks.reduce((sum, week) => sum + week.usd, 0);
  const detectors = spendByDetector(rows);

  return (
    <Chrome email={admin.email}>
      <h1>AI spend</h1>
      <p className="lede">
        The last {WEEKS} weeks: {usd(total)} estimated, across every company. Weeks run Monday to Sunday,
        UTC. Estimated from recorded token usage at published rates, not billed.
      </p>
      {error ? <p className="tag open">{error.message}</p> : null}

      <table>
        <thead>
          <tr>
            <th>Week of</th>
            {TIERS.map((tier) => (
              <th key={tier} className="num">
                {TIER_LABEL[tier]}
              </th>
            ))}
            <th className="num">Total</th>
            <th className="num">Model calls</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {weeks.map((week) => (
            <tr key={week.week}>
              <td>{week.week}</td>
              {TIERS.map((tier) => (
                <td key={tier} className="num muted">
                  {week.byTier[tier] ? usd(week.byTier[tier]) : '—'}
                </td>
              ))}
              <td className="num">{usd(week.usd)}</td>
              <td className="num muted">{week.calls}</td>
              <td style={{ width: '25%' }}>
                <div style={{ background: 'currentColor', opacity: 0.35, height: '0.6rem', width: `${(week.usd / peak) * 100}%` }} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>By what spent it</h2>
      <table>
        <thead>
          <tr>
            <th>Detector</th>
            <th>Model</th>
            <th className="num">Calls</th>
            <th className="num">Estimated</th>
          </tr>
        </thead>
        <tbody>
          {detectors.map((row) => (
            <tr key={`${row.detector}|${row.model}`}>
              <td>
                <code>{row.detector}</code>
              </td>
              <td className="muted">{row.model}</td>
              <td className="num">{row.calls}</td>
              <td className="num">{usd(row.usd)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {detectors.length === 0 && !error ? <p className="muted">Nothing spent in this window.</p> : null}
    </Chrome>
  );
}
