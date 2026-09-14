'use client';

import { useActionState } from 'react';
import { sendMagicLink, type LoginState } from './actions';

const initial: LoginState = { status: 'idle' };

export function LoginForm() {
  const [state, action, pending] = useActionState(sendMagicLink, initial);

  if (state.status === 'sent') {
    return <p>If that address has an account, a sign-in link is on its way.</p>;
  }

  return (
    <form action={action} style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
      <input
        name="email"
        type="email"
        placeholder="you@company.com"
        autoComplete="email"
        required
        style={{ flex: '1 1 16rem' }}
      />
      <button type="submit" disabled={pending}>
        {pending ? 'Sending…' : 'Email me a link'}
      </button>
      {state.status === 'error' && (
        <p role="alert" style={{ width: '100%', margin: 0 }}>
          {state.message}
        </p>
      )}
    </form>
  );
}
