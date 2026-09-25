'use client';

import { useActionState, useEffect, useState } from 'react';
import { requestTeammate, type RequestState } from '@/app/(dashboard)/settings/team-actions';

const START: RequestState = { status: 'idle' };

/**
 * An owner asking for someone to be added.
 *
 * A request, not an invitation: the account is created by Tesserafy's
 * operator console, which is the only place that may create one. What the
 * owner gets is a request on record and, below, what became of it.
 */
export function RequestTeammate() {
  const [state, action, pending] = useActionState(requestTeammate, START);
  // Held in state: React resets a form's uncontrolled fields after an action,
  // and a refused request should not wipe what was typed.
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('member');
  const [note, setNote] = useState('');

  // Cleared once a request is on record, and only then.
  useEffect(() => {
    if (state.status !== 'sent') return;
    setEmail('');
    setRole('member');
    setNote('');
  }, [state]);

  return (
    <form action={action}>
      <div className="toolbar" style={{ alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div className="field" style={{ marginBottom: 0 }}>
          <label htmlFor="request-email">Email</label>
          <input
            id="request-email"
            name="email"
            type="email"
            required
            autoComplete="off"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </div>
        <div className="field" style={{ marginBottom: 0, maxWidth: '8rem' }}>
          <label htmlFor="request-role">Role</label>
          <select id="request-role" name="role" value={role} onChange={(event) => setRole(event.target.value)}>
            <option value="member">member</option>
            <option value="owner">owner</option>
          </select>
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label htmlFor="request-note">Note (optional)</label>
          <input
            id="request-note"
            name="note"
            maxLength={500}
            placeholder="joins the sales team on Monday"
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        </div>
        <button type="submit" disabled={pending}>
          {pending ? 'Asking…' : 'Ask for them to be added'}
        </button>
      </div>
      {state.status === 'error' ? <p role="alert">{state.message}</p> : null}
      {state.status === 'sent' ? (
        <p role="status">
          Asked. Tesserafy will add {state.email} and send them a sign-in link; it shows below
          when it is done.
        </p>
      ) : null}
    </form>
  );
}
