'use client';

import { useActionState, useState } from 'react';
import { MIN_PASSWORD } from '@/lib/password';
import { signUp, type SignupState } from './actions';

const START: SignupState = { status: 'idle' };

/** An address and a password. The company comes after the address is confirmed. */
export function SignupForm() {
  const [state, action, pending] = useActionState(signUp, START);
  // Held in state so a refused attempt keeps the address typed.
  const [email, setEmail] = useState('');

  if (state.status === 'sent') {
    return (
      <div className="card">
        <p style={{ marginTop: 0 }}>
          <strong>Check your email.</strong> If {state.email} can sign up, a confirmation link is on
          its way. Open it to name your company and start your fourteen-day trial.
        </p>
        <p className="muted" style={{ marginBottom: 0 }}>
          It can take a minute, and may land in spam. The link works once.
        </p>
      </div>
    );
  }

  return (
    <form action={action}>
      <div className="field">
        <label htmlFor="email">Work email</label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor="password">Password</label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={MIN_PASSWORD}
          required
        />
      </div>
      <button type="submit" disabled={pending}>
        {pending ? 'Creating…' : 'Create account'}
      </button>
      {state.status === 'error' ? <p role="alert">{state.message}</p> : null}
    </form>
  );
}
