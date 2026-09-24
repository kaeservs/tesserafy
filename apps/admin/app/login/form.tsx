'use client';

import { useActionState } from 'react';
import { signIn, type LoginState } from './actions';

const START: LoginState = { status: 'idle' };

export function LoginForm({ denied }: { denied: boolean }) {
  const [state, action, pending] = useActionState(signIn, START);

  return (
    <form action={action} className="card">
      <div style={{ marginBottom: '0.9rem' }}>
        <label htmlFor="email">Email</label>
        <input id="email" name="email" type="email" autoComplete="username" required />
      </div>
      <div style={{ marginBottom: '1rem' }}>
        <label htmlFor="password">Password</label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
      </div>
      <button type="submit" disabled={pending}>
        {pending ? 'Signing in…' : 'Sign in'}
      </button>
      {denied || state.status === 'error' ? (
        <p className="tag open" role="alert" style={{ marginTop: '0.9rem' }}>
          That did not work.
        </p>
      ) : null}
    </form>
  );
}
