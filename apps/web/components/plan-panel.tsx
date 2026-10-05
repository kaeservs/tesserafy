'use client';

import { TableScroll } from '@/components/table-scroll';
import { useActionState, useState, type ReactNode } from 'react';
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
  /** Per seat (ADR 0027): priced and allowed per seat, how many it has, how many are used, the most it may have. */
  per_seat?: boolean;
  seats?: number;
  members?: number;
  seat_limit?: number | null;
  /** Whether the overlay hides from screen sharing on this plan. */
  incognito?: boolean;
}

export interface CatalogPlan {
  id: string;
  name: string;
  price_usd_cents: number;
  rank: number;
  incognito: boolean;
  calls: number;
  extractions: number;
  pattern_runs: number;
  questions: number;
  live_minutes: number;
}

const METER_LABEL: Record<string, string> = {
  calls: 'Imported calls',
  extractions: 'Find insights in a call, or prepare for one',
  pattern_runs: 'Look for patterns',
  questions: 'Questions to Ask',
  live_seconds: 'Live minutes',
};

function day(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', timeZone: 'UTC' }) : '';
}

function dollars(cents: number): string {
  return `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;
}

/** Plans an owner starts a paid plan from, rather than moves between. */
const STARTING = new Set(['none', 'free', 'trial']);

/** Where the company stands, in a sentence. */
function standing(o: PlanOverview, catalog: readonly CatalogPlan[]): string {
  if (o.plan === 'none') {
    return 'No plan. Reading, search, export and deleting still work; the AI features need a plan.';
  }
  if (o.plan === 'free') return 'Free — one seat and a small allowance each month. Starter, Pro or Incognito for more.';
  if (o.plan === 'trial') return `Trial — ends ${day(o.period_end)}. After that you are on Free; choose a plan to keep more.`;
  if (o.plan === 'pilot' || o.plan === 'internal') return `${o.plan_name} — set by Tesserafy, with no monthly limits.`;
  if (o.cancel_at_period_end) {
    return `${o.plan_name} — cancels on ${day(o.period_end)}. After that you are on Free; your calls stay.`;
  }
  if (o.scheduled_plan) {
    const next = catalog.find((plan) => plan.id === o.scheduled_plan)?.name ?? o.scheduled_plan;
    return `${o.plan_name} — moves to ${next} on ${day(o.period_end)}.`;
  }
  const seats = o.per_seat ? (o.seats ?? 1) : 1;
  const price = o.price_usd_cents
    ? o.per_seat
      ? `${dollars(o.price_usd_cents)} a seat × ${seats} = ${dollars(o.price_usd_cents * seats)} a month, `
      : `${dollars(o.price_usd_cents)} a month, `
    : '';
  return `${o.plan_name} — ${price}renews ${day(o.period_end)}.`;
}

function usage(meter: PlanOverview['meters'][number]): string {
  const live = meter.meter === 'live_seconds';
  const used = live ? Math.ceil(meter.used / 60) : meter.used;
  if (meter.limit === null) return `${used} used — no monthly limit`;
  const limit = live ? Math.round(meter.limit / 60) : meter.limit;
  return `${used} of ${limit}`;
}

function PlanCard({
  plan,
  current,
  liveAvailable,
  children,
}: {
  plan: CatalogPlan;
  current: boolean;
  liveAvailable: boolean;
  children: ReactNode;
}) {
  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>
        {plan.name} — {dollars(plan.price_usd_cents)} a seat a month {current ? <span className="muted">(yours)</span> : null}
      </h3>
      <p className="muted" style={{ marginBottom: '0.5rem' }}>
        Each seat: {plan.calls} imported calls, {plan.extractions} “Find insights in this call”, {plan.pattern_runs} “Look for
        patterns”, {plan.questions} questions to Ask, {plan.live_minutes} live minutes
        {liveAvailable ? '' : ' (when live opens)'} — a month.{' '}
        {plan.incognito ? <strong>The overlay is hidden from screen sharing.</strong> : 'The overlay shows if you share your screen.'}
      </p>
      {children}
    </div>
  );
}

/**
 * The plan, what is left of it, and — for an owner — how to change it.
 *
 * Every member sees where the company stands: running out of calls
 * mid-month is something the person importing them should be able to see
 * coming. Only an owner is offered the buttons, because only an owner may
 * change what the company pays for. Paid plans are per seat (ADR 0027): each
 * seat brings its allowance, and nobody joins without one.
 */
export function PlanPanel({
  overview,
  catalog,
  isOwner,
  liveAvailable,
  billing = 'free',
  returnedFromCheckout = false,
  page = '/settings',
  owners = [],
}: {
  overview: PlanOverview;
  catalog: CatalogPlan[];
  isOwner: boolean;
  /** False until live calls open for this company: the minutes are shown as coming. */
  liveAvailable: boolean;
  /**
   * How the plan is paid for (ADR 0025): free until payments are on; then a
   * paid plan starts at Stripe's checkout; once paying, everything is in
   * Stripe's billing page.
   */
  billing?: 'free' | 'checkout' | 'stripe';
  /** Back from checkout: Stripe has the payment, and its word may be seconds behind. */
  returnedFromCheckout?: boolean;
  /** Where the panel is, so a press comes back to it. */
  page?: '/settings' | '/profile';
  /** Who can change the plan, for a member to ask. */
  owners?: readonly string[];
}) {
  // One action for every button, so the message below is always about the
  // last one pressed.
  const [result, act, busy] = useActionState(planAction, START);
  const granted = overview.plan === 'pilot' || overview.plan === 'internal';
  const pending = overview.cancel_at_period_end || overview.scheduled_plan !== null;
  const members = Math.max(overview.members ?? 1, 1);
  const [seats, setSeats] = useState(Math.max(overview.seats ?? 1, members));
  const currentRank = catalog.find((plan) => plan.id === overview.plan)?.rank ?? -1;
  const starting = STARTING.has(overview.plan);

  return (
    <div>
      <p>
        <strong>{standing(overview, catalog)}</strong>
      </p>
      {overview.seat_limit != null ? (
        <p className="muted">
          Seats: {overview.members ?? 1} of {overview.seat_limit} used.
          {(overview.members ?? 1) >= overview.seat_limit ? ' Add a seat before inviting anyone.' : ''}
        </p>
      ) : null}
      <TableScroll label="Plan allowance">
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
                  {meter.meter === 'live_seconds' && !liveAvailable ? <span className="muted"> — live calls open soon</span> : null}
                </td>
                <td className="muted when">{usage(meter)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableScroll>

      {returnedFromCheckout ? (
        <p role="status">
          Stripe has your payment. The plan starts as soon as Stripe confirms it, usually within seconds; refresh if it
          has not.
        </p>
      ) : null}

      {isOwner && !granted && billing === 'stripe' ? (
        <form action={act}>
          <input type="hidden" name="page" value={page} />
          <input type="hidden" name="intent" value="billing" />
          <button type="submit" disabled={busy}>
            Manage billing
          </button>{' '}
          <span className="muted">Change plan, seats, card or invoices, or cancel, in Stripe&apos;s billing page.</span>
        </form>
      ) : null}

      {isOwner && !granted && billing !== 'stripe' ? (
        <div className="toolbar" style={{ marginBottom: '0.75rem' }}>
          <label htmlFor={`seats${page.replace('/', '-')}`}>Seats</label>
          <input
            id={`seats${page.replace('/', '-')}`}
            type="number"
            min={members}
            max={500}
            value={seats}
            onChange={(event) => setSeats(Math.max(members, Math.min(500, Number(event.target.value) || members)))}
            style={{ width: '6rem' }}
          />
          <span className="muted">
            {members} {members === 1 ? 'person' : 'people'} in the company. Each seat is priced, and brings its own allowance.
          </span>
          {overview.per_seat && billing === 'free' && seats !== (overview.seats ?? 1) ? (
            <form action={act} style={{ display: 'inline' }}>
              <input type="hidden" name="page" value={page} />
              <input type="hidden" name="intent" value="seats" />
              <input type="hidden" name="seats" value={seats} />
              <button type="submit" disabled={busy}>
                Set {seats} seats
              </button>
            </form>
          ) : null}
        </div>
      ) : null}

      {isOwner && !granted && billing === 'checkout' ? (
        <div className="plan-choices">
          {catalog.map((plan) => {
            const current = overview.plan === plan.id;
            const label = starting ? `Start ${plan.name}` : current ? `Pay for ${plan.name} to keep it` : `Switch to ${plan.name}`;
            return (
              <PlanCard key={plan.id} plan={plan} current={current} liveAvailable={liveAvailable}>
                <form action={act}>
                  <input type="hidden" name="page" value={page} />
                  <input type="hidden" name="intent" value="checkout" />
                  <input type="hidden" name="plan" value={plan.id} />
                  <input type="hidden" name="seats" value={seats} />
                  <button type="submit" disabled={busy}>
                    {label} — {seats} {seats === 1 ? 'seat' : 'seats'}, {dollars(plan.price_usd_cents * seats)} a month
                  </button>
                </form>
              </PlanCard>
            );
          })}
          <p className="muted">
            Paid monthly through Stripe, per seat. Once you pay, change plan, seats or cancel any time in billing.
            {overview.per_seat && !starting ? ` The free plan you have runs to ${day(overview.period_end)}.` : ''}
          </p>
        </div>
      ) : null}

      {isOwner && !granted && billing === 'free' ? (
        <div className="plan-choices">
          {catalog.map((plan) => {
            const current = overview.plan === plan.id;
            const label = starting
              ? `Start ${plan.name}`
              : current
                ? pending
                  ? `Keep ${plan.name}`
                  : null
                : plan.rank > currentRank
                  ? `Upgrade to ${plan.name}`
                  : overview.scheduled_plan === plan.id
                    ? null
                    : `Move to ${plan.name} at the end of this period`;
            return (
              <PlanCard key={plan.id} plan={plan} current={current} liveAvailable={liveAvailable}>
                {label ? (
                  <form action={act}>
                    <input type="hidden" name="page" value={page} />
                    <input type="hidden" name="intent" value="change" />
                    <input type="hidden" name="plan" value={plan.id} />
                    <button type="submit" disabled={busy}>
                      {label}
                    </button>
                  </form>
                ) : null}
              </PlanCard>
            );
          })}
          {overview.per_seat && !overview.cancel_at_period_end ? (
            <form action={act}>
              <input type="hidden" name="page" value={page} />
              <input type="hidden" name="intent" value="cancel" />
              <button type="submit" disabled={busy}>
                Cancel plan
              </button>{' '}
              <span className="muted">It runs to {day(overview.period_end)}; then you are on Free, and your calls stay.</span>
            </form>
          ) : null}
          <p className="muted">
            Payments are not live yet: plans are free until checkout opens. Upgrades apply at once; moving down or
            cancelling waits for the end of the period you have.
          </p>
        </div>
      ) : null}
      {!isOwner && !granted ? (
        <p className="muted">
          The plan is your company&apos;s, so only an owner can change it
          {owners.length > 0 ? `: ask ${owners.join(' or ')}.` : '.'}
        </p>
      ) : null}

      {result.status === 'done' ? <p role="status">{result.message}</p> : null}
      {result.status === 'error' ? <p role="alert">{result.message}</p> : null}
    </div>
  );
}
