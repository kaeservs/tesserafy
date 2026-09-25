'use client';

import { useActionState, useState } from 'react';
import { removeMember, type RemoveState } from '@/app/(dashboard)/settings/team-actions';

const START: RemoveState = { status: 'idle' };

/**
 * Removing someone, in two clicks.
 *
 * The second click says what happens, because the consequence is immediate
 * and total — every call, at once — and a single button beside a name is too
 * easy to press meaning the row next to it. It cannot be undone from here:
 * putting someone back goes through the operator, as adding them did.
 */
export function RemoveMember({ userId, email }: { userId: string; email: string }) {
  const [state, action, pending] = useActionState(removeMember, START);
  const [asking, setAsking] = useState(false);

  if (!asking) {
    return (
      <button type="button" onClick={() => setAsking(true)}>
        Remove
      </button>
    );
  }

  return (
    <form action={action} className="remove-confirm">
      <input type="hidden" name="userId" value={userId} />
      <span>Remove {email}? They lose access to every call at once.</span>
      <button type="submit" disabled={pending}>
        {pending ? 'Removing…' : 'Yes, remove'}
      </button>
      <button type="button" onClick={() => setAsking(false)} disabled={pending}>
        Cancel
      </button>
      {state.status === 'error' ? <p role="alert">{state.message}</p> : null}
    </form>
  );
}
