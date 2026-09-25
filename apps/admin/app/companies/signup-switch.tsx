'use client';

import { useActionState } from 'react';
import { setSignupOpen, type SignupSwitchState } from './actions';

const START: SignupSwitchState = { status: 'idle' };

/**
 * Whether brands can sign up themselves.
 *
 * Kept closed until email works: every sign-up needs a confirmation email,
 * and without a provider Supabase sends two an hour. Opening it is the one
 * step between Resend being connected and brands signing up — no deploy.
 */
export function SignupSwitch({ open, changed }: { open: boolean; changed: string | null }) {
  const [state, action, pending] = useActionState(setSignupOpen, START);

  return (
    <form action={action} className="card row" style={{ alignItems: 'center' }}>
      <input type="hidden" name="open" value={open ? 'false' : 'true'} />
      <div>
        <strong>Self-serve sign-up is {open ? 'open' : 'closed'}.</strong>{' '}
        <span className="muted">
          {open
            ? 'Anyone can create an account at /signup and start a fourteen-day trial after confirming their email.'
            : 'Brands cannot sign up themselves; companies are created here. Open it once email sending works.'}
          {changed ? ` Last changed ${changed}.` : ''}
        </span>
      </div>
      <div className="go">
        <button type="submit" className={open ? 'danger' : undefined} disabled={pending}>
          {pending ? '…' : open ? 'Close sign-up' : 'Open sign-up'}
        </button>
      </div>
      {state.status === 'error' ? (
        <p className="tag open" role="alert">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
