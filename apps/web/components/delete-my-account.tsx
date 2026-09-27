'use client';

import { useActionState, useState } from 'react';
import { requestDeletion, type DeletionState } from '@/app/(dashboard)/account/deletion-actions';

const START: DeletionState = { status: 'idle' };

/**
 * Asking for your own account to be deleted.
 *
 * Opened by a first click, then confirmed by typing the address: leaving the
 * company is immediate and cannot be undone from here, so it is not one
 * button. The address is held in state because React resets a form's
 * uncontrolled fields after an action, and a refused attempt should not clear
 * what was typed.
 */
export function DeleteMyAccount({ email, company }: { email: string; company: string | null }) {
  const [state, action, pending] = useActionState(requestDeletion, START);
  const [asking, setAsking] = useState(false);
  const [typed, setTyped] = useState('');

  if (!asking) {
    return (
      <button type="button" onClick={() => setAsking(true)}>
        Delete my account…
      </button>
    );
  }

  return (
    <form action={action}>
      <ul>
        {company ? (
          <li>
            You leave <strong>{company}</strong> now, and lose access to its calls at once. Its
            owner sees that you left.
          </li>
        ) : null}
        <li>You are signed out. Until your login is deleted, signing in shows only that it is being deleted.</li>
        <li>
          Tesserafy deletes your login — your address and password — within 30 days, usually much
          sooner.
        </li>
        {company ? (
          <li className="muted">
            Calls you added stay with {company}; they are its calls. They will no longer say who
            added them.
          </li>
        ) : null}
      </ul>
      <div className="field">
        <label htmlFor="delete-email">Type your address to confirm: {email}</label>
        <input
          id="delete-email"
          name="email"
          type="email"
          autoComplete="off"
          required
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
        />
      </div>
      {state.status === 'error' ? <p role="alert">{state.message}</p> : null}
      <div className="toolbar">
        <button type="submit" disabled={pending}>
          {pending ? 'Asking…' : 'Delete my account'}
        </button>
        <button type="button" onClick={() => setAsking(false)} disabled={pending}>
          Cancel
        </button>
      </div>
    </form>
  );
}
