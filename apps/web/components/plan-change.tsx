'use client';

import Link from 'next/link';
import { useEffect, useRef, useTransition } from 'react';
import { markPlanSeen } from '@/app/(dashboard)/onboarding-actions';
import { planChanges, type CatalogRow } from '@/lib/plan-catalog';

/**
 * Once, to each person, after their company's plan changes (ADR 0027): what
 * the new plan brings, or on the way down what it no longer has — whoever
 * made the change, and whether it was an upgrade, a downgrade at the end of a
 * period, or a trial running out. "Got it" records the plan as seen.
 */
export function PlanChange({ from, to, isOwner }: { from: CatalogRow | null; to: CatalogRow; isOwner: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [, startTransition] = useTransition();
  const { direction, lines } = planChanges(from, to);

  useEffect(() => {
    if (!dialog.current?.open) dialog.current?.showModal();
  }, []);

  function seen() {
    dialog.current?.close();
    startTransition(() => markPlanSeen());
  }

  return (
    <dialog ref={dialog} className="onboarding" aria-labelledby="plan-change-title" onCancel={seen}>
      <p className="onboarding-kicker">{direction === 'up' ? 'What’s new' : 'What changed'}</p>
      <h2 id="plan-change-title">{direction === 'up' ? `Welcome to ${to.name}` : `You’re now on ${to.name}`}</h2>
      <p className="muted">
        Your company moved {from ? `from ${from.name} ` : ''}to {to.name}.{' '}
        {direction === 'up' ? 'It applies now:' : 'Everything you made stays. What is different:'}
      </p>
      {lines.length > 0 ? (
        <ul className="onboarding-facts">
          {lines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      ) : null}
      {direction === 'up' && to.incognito && !from?.incognito ? (
        <p className="onboarding-note">
          From your next call, the overlay is left out of every screen share and recording. Nothing to install.
        </p>
      ) : null}
      <div className="onboarding-foot">
        <Link href="/settings/membership" className="button-secondary" onClick={seen}>
          {isOwner ? 'Plan and billing' : 'See the plan'}
        </Link>
        <button type="button" className="button-primary" onClick={seen}>
          Got it
        </button>
      </div>
    </dialog>
  );
}
