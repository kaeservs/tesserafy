'use client';

import { useActionState } from 'react';
import { makeToken, revokeToken, type TokenState } from './actions';

const START: TokenState = { status: 'idle' };

/** Make or revoke the token; a new one is shown here once and never again. */
export function TokenControls({ live }: { live: boolean }) {
  const [made, make, making] = useActionState(makeToken, START);
  const [revoked, revoke, revoking] = useActionState(revokeToken, START);
  return (
    <>
      <form action={make} style={{ display: 'inline' }}>
        <button type="submit" disabled={making}>
          {live ? 'Make a new token (replaces this one)' : 'Make a token'}
        </button>
      </form>{' '}
      {live ? (
        <form action={revoke} style={{ display: 'inline' }}>
          <button type="submit" className="danger" disabled={revoking}>
            Revoke
          </button>
        </form>
      ) : null}
      {made.status === 'made' ? (
        <div className="card" style={{ marginTop: '1rem' }}>
          <p>
            <strong>Copy it now</strong> into the n8n credential. It is not stored here and will not be shown again.
          </p>
          <code style={{ wordBreak: 'break-all' }}>{made.token}</code>
        </div>
      ) : null}
      {made.status === 'error' ? <p className="tag open">{made.message}</p> : null}
      {revoked.status === 'error' ? <p className="tag open">{revoked.message}</p> : null}
    </>
  );
}
