'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, useTransition } from 'react';
import { Icon } from '@/components/icons';
import { SampleCallButton } from '@/components/sample-call-button';
import { finishOnboarding } from '@/app/(dashboard)/onboarding-actions';
import { dollars, planFacts, type CatalogRow } from '@/lib/plan-catalog';

export interface OnboardingPlan {
  readonly row: CatalogRow;
  readonly seats: number;
  readonly members: number;
}

const DIALOG_ID = 'onboarding';

/**
 * Three steps, once, for someone new: the overlay, a first call, and what
 * their plan gives them. Each step ticks itself from what has actually
 * happened (the overlay has signed in; the company has a call), and the tour
 * opens on the first step not done, so leaving for the sample call and coming
 * back picks up where it was. Finishing or skipping records it, and it is not
 * shown again unless asked for (TourButton).
 */
export function Onboarding({
  show,
  isOwner,
  overlayInstalled,
  hasCalls,
  offerSample,
  live,
  plan,
}: {
  /** Not onboarded yet: opens by itself. */
  show: boolean;
  isOwner: boolean;
  overlayInstalled: boolean;
  hasCalls: boolean;
  offerSample: boolean;
  /** Live calls are open to this company. */
  live: boolean;
  plan: OnboardingPlan | null;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const firstOpen = !overlayInstalled ? 0 : !hasCalls ? 1 : 2;
  const [step, setStep] = useState(firstOpen);
  const [, startTransition] = useTransition();

  useEffect(() => {
    if (show && !dialog.current?.open) dialog.current?.showModal();
  }, [show]);

  function finish() {
    dialog.current?.close();
    if (show) startTransition(() => finishOnboarding());
  }

  const done = [overlayInstalled, hasCalls, false];
  const incognito = plan?.row.incognito ?? false;

  return (
    <dialog
      id={DIALOG_ID}
      ref={dialog}
      className="onboarding"
      aria-labelledby="onboarding-title"
      onClose={() => setStep(firstOpen)}
    >
      <div className="onboarding-head">
        <span className="onboarding-brand">
          <Icon name="logo" size={22} /> Getting started
        </span>
        <button type="button" className="link-button" onClick={finish}>
          {show ? 'Skip the tour' : 'Close'}
        </button>
      </div>
      <ol className="onboarding-progress" aria-label={`Step ${step + 1} of 3`}>
        {[0, 1, 2].map((index) => (
          <li key={index} className={index <= step ? 'on' : undefined} />
        ))}
      </ol>

      {step === 0 ? (
        <section>
          <p className="onboarding-kicker">Step 1 of 3 {done[0] ? <span className="pill pill-on">Done</span> : null}</p>
          <h2 id="onboarding-title">Put Tesserafy in your meetings</h2>
          <p>
            The overlay sits over Zoom, Meet or Teams. It scores the call against your criteria as you talk and helps with
            what to say next. No bot joins the call.
          </p>
          <p className="onboarding-note">
            {incognito
              ? 'On Incognito the overlay is hidden from screen sharing: nobody in the meeting sees it, even while you share.'
              : 'On your plan the overlay shows if you share your screen. Incognito hides it from screen sharing.'}
          </p>
          <a className="button-primary" href="/overlay" target="_blank" rel="noopener">
            {overlayInstalled ? 'Get it on another computer' : 'Download the overlay'}
          </a>
        </section>
      ) : null}

      {step === 1 ? (
        <section>
          <p className="onboarding-kicker">Step 2 of 3 {done[1] ? <span className="pill pill-on">Done</span> : null}</p>
          <h2 id="onboarding-title">Your first call</h2>
          {hasCalls ? (
            <>
              <p>Your company has a call in. Open it to see its score, and the quote behind every criterion it met.</p>
              <Link className="button-primary" href="/conversations" onClick={() => dialog.current?.close()}>
                See your calls
              </Link>
            </>
          ) : (
            <>
              <p>See a scored call before your own: then import a transcript from Zoom, Meet, Teams, Otter or Fireflies.</p>
              {offerSample ? <SampleCallButton /> : null}
              <p>
                <Link className="button-secondary" href="/conversations/new">
                  Import a transcript
                </Link>
              </p>
            </>
          )}
          <p className="onboarding-note">
            {live
              ? 'Or start the overlay in your next meeting: it listens to both sides and scores the call as it happens.'
              : 'Live calls open soon. Until then, import the transcript your meeting app exports.'}
          </p>
        </section>
      ) : null}

      {step === 2 ? (
        <section>
          <p className="onboarding-kicker">Step 3 of 3</p>
          {plan ? <PlanStep plan={plan} isOwner={isOwner} onUpgrade={finish} /> : <h2 id="onboarding-title">You are set</h2>}
        </section>
      ) : null}

      <div className="onboarding-foot">
        {step > 0 ? (
          <button type="button" className="button-secondary" onClick={() => setStep(step - 1)}>
            Back
          </button>
        ) : (
          <span />
        )}
        {step < 2 ? (
          <button type="button" className="button-primary" onClick={() => setStep(step + 1)}>
            Next
          </button>
        ) : (
          <button type="button" className="button-primary" onClick={finish}>
            {show ? 'Finish' : 'Close'}
          </button>
        )}
      </div>
    </dialog>
  );
}

/** What the person's plan gives them: an upgrade on Free, the bill and the seats on a paid one. */
function PlanStep({ plan, isOwner, onUpgrade }: { plan: OnboardingPlan; isOwner: boolean; onUpgrade: () => void }) {
  const { row, seats, members } = plan;
  const free = row.id === 'free';
  return (
    <>
      <h2 id="onboarding-title">You&apos;re on {row.name}</h2>
      {row.price_usd_cents !== null && row.per_seat ? (
        <p className="onboarding-price">
          {dollars(row.price_usd_cents)} a seat × {seats} = <strong>{dollars(row.price_usd_cents * seats)} a month</strong>
        </p>
      ) : null}
      <ul className="onboarding-facts">
        {planFacts(row).map((fact) => (
          <li key={fact}>{fact}</li>
        ))}
      </ul>
      {row.incognito ? (
        <p className="onboarding-note">
          Incognito: the overlay is left out of every screen share and recording. It still shows on your own computer, in
          Task Manager and the menu bar — hidden from the meeting, never from you.
        </p>
      ) : null}
      {row.per_seat && row.max_seats !== 1 ? (
        <p className="muted">
          Seats: {members} of {seats} used.{' '}
          {isOwner ? (
            <>
              Add teammates on <Link href="/settings#team-heading">Settings</Link>
              {members >= seats ? ', after adding a seat on Plan and billing' : ''}; each seat brings its own allowance.
            </>
          ) : (
            'Each seat brings its own allowance.'
          )}
        </p>
      ) : null}
      {free && isOwner ? (
        <p>
          <a className="button-secondary" href="#plans" onClick={onUpgrade}>
            See the plans
          </a>{' '}
          <span className="muted">Starter, Pro and Incognito, per seat.</span>
        </p>
      ) : null}
      {!isOwner ? <p className="muted">The plan is your company&apos;s: an owner can change it.</p> : null}
    </>
  );
}

/** Opens the tour again, on Home. */
export function TourButton() {
  return (
    <button
      type="button"
      className="link-button"
      onClick={() => (document.getElementById(DIALOG_ID) as HTMLDialogElement | null)?.showModal()}
    >
      Take the tour again
    </button>
  );
}
