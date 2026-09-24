'use client';

import { useActionState } from 'react';
import { openSession, type SessionState } from './actions';

const START: SessionState = { status: 'idle' };

/**
 * The button, and the two sentences beside it.
 *
 * A reason is required by the form and again by the database, because a
 * required field with no teeth becomes a full stop. The result is a link
 * rather than an automatic redirect on purpose: opening it replaces whatever
 * session this browser holds for the product, and a click that silently signs
 * you out of your own account and into somebody else's is a surprise nobody
 * needs. Open it in another profile or a private window.
 */
export function OpenSession({ subjectId, email }: { subjectId: string; email: string }) {
  const [state, action, pending] = useActionState(openSession, START);

  if (state.status === 'ready' && state.email === email) {
    return (
      <div className="card">
        <p style={{ marginTop: 0 }}>
          Recorded as <code>{state.accessId}</code>.
        </p>
        <p>
          <a className="link" href={state.link} target="_blank" rel="noreferrer">
            Open a session as {email} →
          </a>
        </p>
        {state.landsElsewhere ? (
          <p className="tag open" style={{ display: 'block', padding: '0.6rem' }}>
            This link will land on <code>{state.landsElsewhere}</code>, not on the confirm page
            it asked for. Supabase falls back to the Site URL when the redirect is missing from the
            request or absent from the allow-list, so check that{' '}
            <code>{`${process.env.NEXT_PUBLIC_APP_URL ?? '<app url>'}/auth/confirm`}</code> is under
            Authentication → URL Configuration → Redirect URLs. The link still works meanwhile:
            the product forwards a session that lands at the wrong door.
          </p>
        ) : null}
        <p className="muted" style={{ marginBottom: 0 }}>
          Open it in a private window. Everything you do will be attributed to them; the record
          above is the only thing that says otherwise.
        </p>
      </div>
    );
  }

  return (
    <form action={action} className="row">
      <input type="hidden" name="subjectId" value={subjectId} />
      <input type="hidden" name="email" value={email} />
      <div>
        <label htmlFor={`reason-${subjectId}`}>Reason</label>
        <input
          id={`reason-${subjectId}`}
          name="reason"
          required
          minLength={3}
          placeholder="blank dashboard, ticket 12"
        />
      </div>
      <div className="narrow">
        <label htmlFor={`minutes-${subjectId}`}>Minutes</label>
        <select id={`minutes-${subjectId}`} name="minutes" defaultValue="30">
          <option value="15">15</option>
          <option value="30">30</option>
          <option value="60">60</option>
          <option value="240">240</option>
        </select>
      </div>
      <div className="go">
        <button type="submit" className="danger" disabled={pending}>
          {pending ? 'Opening…' : 'Open session'}
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
