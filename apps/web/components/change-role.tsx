'use client';

import { useActionState, useState } from 'react';
import { changeRole, type RemoveState } from '@/app/(dashboard)/settings/team-actions';

const START: RemoveState = { status: 'idle' };

/**
 * Making someone an owner, or an owner a member, in two clicks.
 *
 * The second click says what changes, because an owner can change the plan,
 * how long calls are kept, who is on the team and who owns it — and stepping
 * down yourself hands all of that to the others at once.
 */
export function ChangeRole({
  userId,
  email,
  to,
  isYou,
}: {
  userId: string;
  email: string;
  to: 'owner' | 'member';
  isYou: boolean;
}) {
  const [state, action, pending] = useActionState(changeRole, START);
  const [asking, setAsking] = useState(false);

  const label = to === 'owner' ? 'Make owner' : isYou ? 'Step down to member' : 'Make member';
  const consequence =
    to === 'owner'
      ? `Make ${email} an owner? They will be able to change the plan, how long calls are kept, the team and who owns it, and take an export.`
      : isYou
        ? 'Step down to member? You keep reading every call; the plan, retention, team and exports become the other owners’ to change.'
        : `Make ${email} a member? They keep reading every call and lose the owner’s controls.`;

  if (!asking) {
    return (
      <button type="button" onClick={() => setAsking(true)}>
        {label}
      </button>
    );
  }

  return (
    <form action={action} className="remove-confirm">
      <input type="hidden" name="userId" value={userId} />
      <input type="hidden" name="role" value={to} />
      <span>{consequence}</span>
      <button type="submit" disabled={pending}>
        {pending ? 'Changing…' : 'Yes'}
      </button>
      <button type="button" onClick={() => setAsking(false)} disabled={pending}>
        Cancel
      </button>
      {state.status === 'error' ? <p role="alert">{state.message}</p> : null}
    </form>
  );
}
