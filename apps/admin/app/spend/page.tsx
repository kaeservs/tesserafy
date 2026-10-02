import Link from 'next/link';
import { spendByDetector, spendByFeature, spendByWeek, type SpendRow } from '@tesserafy/db';
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
const MARGIN_DAYS = 30;
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
  const features = spendByFeature(rows);
  // Cost against price: what each company's AI use cost over the last
  // MARGIN_DAYS, beside what its plan charges a month. Closed companies with
  // nothing spent are left out.
  const { data: marginRows, error: marginError } = await admin.db.rpc('admin_company_margin', { p_days: MARGIN_DAYS });
  const margins = (marginRows ?? [])
    .map((row) => ({
      companyId: row.company_id,
      name: row.name,
      plan: row.plan,
      // Null for plans that are not sold: trial, pilot, internal.
      price: (row.price_usd_cents as number | null) === null ? null : row.price_usd_cents / 100,
      closed: (row.closed_at as string | null) !== null,
      calls: Number(row.model_calls),
      usd: Number(row.usd),
    }))
    .filter((row) => !row.closed || row.usd > 0);

  return (
    <Chrome email={admin.email}>
      <h1>AI spend</h1>
      <p className="lede">
        The last {WEEKS} weeks: {usd(total)} estimated, across every company. Weeks run Monday to Sunday,
        UTC. Estimated from recorded token usage at published rates, not billed.
      </p>
      {error ? <p className="tag open">{error.message}</p> : null}

      <table tabIndex={0}>
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

      <h2>By feature</h2>
      <p className="muted">What people use, whatever the prompt version: the overlay's help, Ask, follow-up emails, scoring.</p>
      <table tabIndex={0}>
        <thead>
          <tr>
            <th>Feature</th>
            <th className="num">Calls</th>
            <th className="num">Estimated</th>
            <th className="num">Share</th>
          </tr>
        </thead>
        <tbody>
          {features.map((row) => (
            <tr key={row.feature}>
              <td>{row.feature}</td>
              <td className="num">{row.calls}</td>
              <td className="num">{usd(row.usd)}</td>
              <td className="num muted">{total > 0 ? `${Math.round((row.usd / total) * 100)}%` : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>By what spent it</h2>
      <table tabIndex={0}>
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

      <h2>Cost against price, last {MARGIN_DAYS} days</h2>
      <p className="muted">
        Each company&apos;s estimated AI cost over the last {MARGIN_DAYS} days beside its plan&apos;s monthly price. A company
        costing more than it pays is marked; a plan that is not sold has no price to compare.
      </p>
      {marginError ? <p className="tag open">{marginError.message}</p> : null}
      <table tabIndex={0}>
        <thead>
          <tr>
            <th>Company</th>
            <th>Plan</th>
            <th className="num">Price a month</th>
            <th className="num">AI cost</th>
            <th className="num">Of the price</th>
            <th className="num">Model calls</th>
          </tr>
        </thead>
        <tbody>
          {margins.map((row) => (
            <tr key={row.companyId}>
              <td>
                <Link href={`/companies/${row.companyId}`}>{row.name}</Link>
                {row.closed ? <span className="muted"> (closed)</span> : null}
              </td>
              <td className="muted">{row.plan}</td>
              <td className="num">{row.price === null ? <span className="muted">not sold</span> : usd(row.price)}</td>
              <td className="num">{usd(row.usd)}</td>
              <td className="num">
                {row.price === null ? (
                  <span className="muted">—</span>
                ) : row.usd > row.price ? (
                  <span className="tag open">{Math.round((row.usd / row.price) * 100)}%</span>
                ) : (
                  `${Math.round((row.usd / row.price) * 100)}%`
                )}
              </td>
              <td className="num muted">{row.calls}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Chrome>
  );
}
