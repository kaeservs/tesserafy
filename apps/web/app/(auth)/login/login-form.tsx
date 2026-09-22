'use client';

import { useActionState, useState } from 'react';
import { sendMagicLink, signInWithPassword, type LoginState } from './actions';

const initial: LoginState = { status: 'idle' };

/**
 * Two ways in, and the quicker one first.
 *
 * A magic link is the right default for an invited customer: nothing to
 * choose, nothing to remember, nothing to leak. It is the wrong default for
 * someone checking a scorecard twenty times an afternoon, because every check
 * costs a round trip through an inbox. So the password form leads and the link
 * is a second option rather than the only one.
 *
 * Neither path creates an account. Supabase refuses an address it has not
 * seen, and accounts are attached to a company server-side — a self-registered
 * user would belong to no tenant and see nothing.
 */
export function LoginForm() {
  const [password, passwordAction, signingIn] = useActionState(signInWithPassword, initial);
  const [link, linkAction, sending] = useActionState(sendMagicLink, initial);
  const [showLink, setShowLink] = useState(false);

  if (link.status === 'sent') {
    return <p>If that address has an account, a sign-in link is on its way.</p>;
  }

  return (
    <>
      <form action={passwordAction}>
        <div className="field">
          <label htmlFor="identifier">Username or email</label>
          <input
            id="identifier"
            name="identifier"
            /* Not type="email": a bare username is valid here, and the browser
               would refuse to submit one. */
            type="text"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            required
          />
        </div>
        <div className="field">
          <label htmlFor="password">Password</label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
          />
        </div>
        <button type="submit" disabled={signingIn}>
          {signingIn ? 'Signing in…' : 'Sign in'}
        </button>
        {password.status === 'error' && <p role="alert">{password.message}</p>}
      </form>

      {showLink ? (
        <form action={linkAction} className="toolbar" style={{ marginTop: '1.5rem' }}>
          <input
            name="email"
            type="email"
            placeholder="you@company.com"
            autoComplete="email"
            required
            className="grow"
            aria-label="Email address for a sign-in link"
          />
          <button type="submit" disabled={sending}>
            {sending ? 'Sending…' : 'Email me a link'}
          </button>
          {link.status === 'error' && <p role="alert">{link.message}</p>}
        </form>
      ) : (
        <p className="muted" style={{ marginTop: '1.5rem' }}>
          <button type="button" className="link-button" onClick={() => setShowLink(true)}>
            Email me a sign-in link instead
          </button>
        </p>
      )}
    </>
  );
}
