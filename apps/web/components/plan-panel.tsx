'use client';

import { useActionState } from 'react';
import { planAction, type PlanActionState } from '@/app/(dashboard)/settings/plan-actions';

const START: PlanActionState = { status: 'idle' };

export interface PlanOverview {
  plan: string;
  plan_name: string;
  price_usd_cents: number | null;
  status: 'trialing' | 'active' | 'canceled';
  period_end: string | null;
  cancel_at_period_end: boolean;
  scheduled_plan: string | null;
  meters: { meter: string; limit: number | null; used: number }[];
}

export interface CatalogPlan {
  id: string;
  name: string;
  price_usd_cents: number;
  calls: number;
  extractions: number;
  pattern_runs: number;
  live_minutes: number;
}

const METER_LABEL: Record<string, string> = {
  calls: 'Imported calls',
  extractions: 'Find insights in a call',
  pattern_runs: 'Look for patterns',
  live_seconds: 'Live minutes',
};

function day(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', timeZone: 'UTC' }) : '';
}

function dollars(cents: number): string {
  return `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;
}

/** Where the company stands, in a sentence. */
function standing(o: PlanOverview): string {
  if (o.plan === 'none') {
    return 'No plan. Reading, search, export and deleting still work; the AI features need a plan.';
  }
  if (o.plan === 'trial') return `Trial — ends ${day(o.period_end)}. Choose Basic or Pro to keep the AI features after that.`;
  if (o.plan === 'pilot' || o.plan === 'internal') return `${o.plan_name} — set by Tesserafy, with no monthly limits.`;
  const price = o.price_usd_cents ? `${dollars(o.price_usd_cents)} a month, ` : '';
  if (o.cancel_at_period_end) {
    return `${o.plan_name} — cancels on ${day(o.period_end)}. After that the AI features stop; your calls stay.`;
  }
  if (o.scheduled_plan) return `${o.plan_name} — moves to ${o.scheduled_plan === 'basic' ? 'Basic' : o.scheduled_plan} on ${day(o.period_end)}.`;
  return `${o.plan_name} — ${price}renews ${day(o.period_end)}.`;
}

function usage(meter: PlanOverview['meters'][number]): string {
  const live = meter.meter === 'live_seconds';
  const used = live ? Math.ceil(meter.used / 60) : meter.used;
  if (meter.limit === null) return `${used} used — no monthly limit`;
  const limit = live ? Math.round(meter.limit / 60) : meter.limit;
  return `${used} of ${limit}`;
}

/**
 * The plan, what is left of it, and — for an owner — how to change it.
 *
 * Every member sees where the company stands: running out of calls
 * mid-month is something the person importing them should be able to see
 * coming. Only an owner is offered the buttons, because only an owner may
 * change what the company pays for.
 */
export function PlanPanel({
  overview,
  catalog,
  isOwner,
  liveAvailable,
}: {
  overview: PlanOverview;
  catalog: CatalogPlan[];
  isOwner: boolean;
  /** False until live scorecards launch for this company: the minutes are shown as coming. */
  liveAvailable: boolean;
}) {
  // One action for every button, so the message below is always about the
  // last one pressed.
  const [result, act, busy] = useActionState(planAction, START);
  const granted = overview.plan === 'pilot' || overview.plan === 'internal';
  const pending = overview.cancel_at_period_end || overview.scheduled_plan !== null;

  return (
    <div>
      <p>
        <strong>{standing(overview)}</strong>
      </p>
      <table className="team">
        <thead>
          <tr>
            <th>This period</th>
            <th>Used</th>
          </tr>
        </thead>
        <tbody>
          {overview.meters.map((meter) => (
            <tr key={meter.meter}>
              <td>
                {METER_LABEL[meter.meter] ?? meter.meter}
                {meter.meter === 'live_seconds' && !liveAvailable ? (
                  <span className="muted"> — live scorecards are coming soon</span>
                ) : null}
              </td>
              <td className="muted when">{usage(meter)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {isOwner && !granted ? (
        <div className="plan-choices">
          {catalog.map((plan) => {
            const current = overview.plan === plan.id;
            const upgrade = overview.plan === 'basic' && plan.id === 'pro';
            const downgrade = overview.plan === 'pro' && plan.id === 'basic';
            const start = overview.plan === 'trial' || overview.plan === 'none';
            const keep = current && pending;
            const label = start
              ? `Start ${plan.name}`
              : upgrade
                ? 'Upgrade to Pro'
                : downgrade
                  ? overview.scheduled_plan === 'basic'
                    ? null
                    : 'Move to Basic at the end of this period'
                  : keep
                    ? `Keep ${plan.name}`
                    : null;
            return (
              <div className="card" key={plan.id}>
                <h3 style={{ marginTop: 0 }}>
                  {plan.name} — {dollars(plan.price_usd_cents)} a month {current ? <span className="muted">(yours)</span> : null}
                </h3>
                <p className="muted" style={{ marginBottom: '0.5rem' }}>
                  {plan.calls} imported calls, {plan.extractions} “Find insights in this call”,{' '}
                  {plan.pattern_runs} “Look for patterns”, {plan.live_minutes} live minutes
                  {liveAvailable ? '' : ' (when live launches)'} — a month.
                </p>
                {label ? (
                  <form action={act}>
                    <input type="hidden" name="intent" value="change" />
                    <input type="hidden" name="plan" value={plan.id} />
                    <button type="submit" disabled={busy}>
                      {label}
                    </button>
                  </form>
                ) : null}
              </div>
            );
          })}
          {(overview.plan === 'basic' || overview.plan === 'pro') && !overview.cancel_at_period_end ? (
            <form action={act}>
              <input type="hidden" name="intent" value="cancel" />
              <button type="submit" disabled={busy}>
                Cancel plan
              </button>{' '}
              <span className="muted">It runs to {day(overview.period_end)}; your calls stay after that.</span>
            </form>
          ) : null}
          <p className="muted">
            Payments are not live yet: plans are free until checkout opens. Upgrades apply at once;
            moving down or cancelling waits for the end of the period you have.
          </p>
        </div>
      ) : null}
      {!isOwner && !granted ? (
        <p className="muted">Only an owner can change the plan.</p>
      ) : null}

      {result.status === 'done' ? <p role="status">{result.message}</p> : null}
      {result.status === 'error' ? <p role="alert">{result.message}</p> : null}
    </div>
  );
}
