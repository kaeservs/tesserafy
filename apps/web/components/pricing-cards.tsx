'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { planAction, type PlanActionState } from '@/app/(dashboard)/settings/plan-actions';
import { dollars, planFacts, type CatalogRow } from '@/lib/plan-catalog';

const START: PlanActionState = { status: 'idle' };

/**
 * The plans above the company's, on Home (ADR 0027): the price a seat, what
 * each seat brings, and for an owner the button that upgrades — at once while
 * plans are free, through Stripe's checkout once payments are on, in Stripe's
 * billing page once the company pays there. The full panel, with seats and
 * moving down, stays on Plan and billing.
 */
export function PricingCards({
  plans,
  currentName,
  seats,
  isOwner,
  billing,
}: {
  plans: readonly CatalogRow[];
  currentName: string;
  seats: number;
  isOwner: boolean;
  billing: 'free' | 'checkout' | 'stripe';
}) {
  const [result, act, busy] = useActionState(planAction, START);
  if (plans.length === 0) return null;
  return (
    <section id="plans" className="pricing" aria-labelledby="plans-heading">
      <h2 id="plans-heading">Upgrade</h2>
      <p className="muted">
        You&apos;re on {currentName}. Paid plans are per seat, monthly, and every seat brings its own allowance.
      </p>
      <div className="pricing-grid">
        {plans.map((plan) => (
          <div key={plan.id} className="card pricing-card">
            <h3>
              {plan.name} {plan.incognito ? <span className="pill pill-on">Hidden from screen share</span> : null}
            </h3>
            {plan.price_usd_cents !== null ? (
              <p className="pricing-price">
                <span>{dollars(plan.price_usd_cents)}</span> a seat a month
              </p>
            ) : null}
            <ul className="onboarding-facts">
              {planFacts(plan).map((fact) => (
                <li key={fact}>{fact}</li>
              ))}
            </ul>
            {isOwner ? (
              <form action={act}>
                <input type="hidden" name="page" value="/dashboard" />
                <input type="hidden" name="intent" value={billing === 'free' ? 'change' : billing === 'checkout' ? 'checkout' : 'billing'} />
                <input type="hidden" name="plan" value={plan.id} />
                <input type="hidden" name="seats" value={seats} />
                <button type="submit" disabled={busy}>
                  {billing === 'stripe' ? `Upgrade to ${plan.name} in billing` : `Upgrade to ${plan.name}`}
                </button>
              </form>
            ) : null}
          </div>
        ))}
      </div>
      <p className="muted">
        {isOwner ? (
          <>
            Seats, moving down and cancelling are on <Link href="/profile#membership">Plan and billing</Link>.
            {billing === 'free' ? ' Payments are not live yet: an upgrade is free and applies at once.' : ''}
          </>
        ) : (
          'The plan is your company’s: ask an owner to upgrade.'
        )}
      </p>
      {result.status === 'done' ? <p role="status">{result.message}</p> : null}
      {result.status === 'error' ? <p role="alert">{result.message}</p> : null}
    </section>
  );
}
