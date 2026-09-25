'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { setPassword, type PasswordState } from '@/app/(dashboard)/account/actions';
import { MIN_PASSWORD } from '@/lib/password';

const START: PasswordState = { status: 'idle' };

/** Choosing a password, or changing it. */
export function PasswordForm({ invited }: { invited: boolean }) {
  const [state, action, pending] = useActionState(setPassword, START);

  if (state.status === 'saved') {
    return (
      <p role="status">
        Password saved. Next time, sign in with your email and this password.{' '}
        {invited ? <Link href="/conversations">Go to your meetings →</Link> : null}
      </p>
    );
  }

  return (
    <form action={action}>
      <div className="field">
        <label htmlFor="password">{invited ? 'Choose a password' : 'New password'}</label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={MIN_PASSWORD}
          required
        />
      </div>
      <div className="field">
        <label htmlFor="repeat">The same again</label>
        <input
          id="repeat"
          name="repeat"
          type="password"
          autoComplete="new-password"
          minLength={MIN_PASSWORD}
          required
        />
      </div>
      <button type="submit" disabled={pending}>
        {pending ? 'Saving…' : 'Save password'}
      </button>
      {state.status === 'error' ? <p role="alert">{state.message}</p> : null}
    </form>
  );
}
