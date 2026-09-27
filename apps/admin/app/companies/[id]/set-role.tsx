'use client';

import { useActionState, useState } from 'react';
import { setMemberRole, type SetRoleState } from '../actions';

const START: SetRoleState = { status: 'idle' };

/**
 * Change one person's role, in two clicks. The database refuses to leave the
 * company without an owner and says so; the refusal is shown beside the row.
 */
export function SetRole({
  companyId,
  userId,
  email,
  to,
}: {
  companyId: string;
  userId: string;
  email: string;
  to: 'owner' | 'member';
}) {
  const [state, action, pending] = useActionState(setMemberRole, START);
  const [asking, setAsking] = useState(false);

  if (!asking) {
    return (
      <button type="button" onClick={() => setAsking(true)}>
        {to === 'owner' ? 'Make owner' : 'Make member'}
      </button>
    );
  }

  return (
    <form action={action} className="row" style={{ flexWrap: 'wrap', gap: '0.3rem', alignItems: 'center' }}>
      <input type="hidden" name="companyId" value={companyId} />
      <input type="hidden" name="userId" value={userId} />
      <input type="hidden" name="role" value={to} />
      <span className="muted">
        Make {email} {to === 'owner' ? 'an owner' : 'a member'}? Recorded under your name.
      </span>
      <button type="submit" disabled={pending}>
        {pending ? '…' : 'Yes'}
      </button>
      <button type="button" onClick={() => setAsking(false)} disabled={pending}>
        Cancel
      </button>
      {state.status === 'error' ? (
        <span className="tag open" role="alert">
          {state.message}
        </span>
      ) : null}
    </form>
  );
}
