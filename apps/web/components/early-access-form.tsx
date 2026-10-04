'use client';

import { useActionState } from 'react';
import { requestEarlyAccess, type EarlyAccessState } from '@/app/early-access-actions';

const START: EarlyAccessState = { status: 'idle' };

/**
 * Asking to be told when Tesserafy opens. The hidden "website" field is for
 * bots: a person never sees it, and a filled one is dropped.
 */
export function EarlyAccessForm() {
  const [state, submit, pending] = useActionState(requestEarlyAccess, START);

  if (state.status === 'done') {
    return (
      <p role="status" className="early-done">
        Thank you — you are on the list. We will email you when there is a place.
      </p>
    );
  }

  return (
    <form action={submit} className="early-form">
      <div className="field">
        <label htmlFor="early-email">Work email</label>
        <input id="early-email" name="email" type="email" autoComplete="email" required maxLength={320} />
      </div>
      <div className="field">
        <label htmlFor="early-company">Company (optional)</label>
        <input id="early-company" name="company" autoComplete="organization" maxLength={120} />
      </div>
      <div className="field">
        <label htmlFor="early-use">You would use it for (optional)</label>
        <select id="early-use" name="use_case" defaultValue="">
          <option value="">Choose one</option>
          <option value="sales">Sales calls</option>
          <option value="onboarding">Onboarding customers</option>
          <option value="support">Support calls</option>
          <option value="other">Something else</option>
        </select>
      </div>
      <div className="early-hidden" aria-hidden="true">
        <label htmlFor="early-website">Website</label>
        <input id="early-website" name="website" tabIndex={-1} autoComplete="off" />
      </div>
      <button type="submit" disabled={pending}>
        {pending ? 'Adding you…' : 'Get early access'}
      </button>
      {state.status === 'error' ? <p role="alert">{state.message}</p> : null}
      <p className="muted early-note">We use this address only to tell you when there is a place.</p>
    </form>
  );
}
