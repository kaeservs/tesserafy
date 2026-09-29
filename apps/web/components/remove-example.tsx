'use client';

import { useActionState } from 'react';
import { removeExample, type ActionState } from '@/app/(dashboard)/conversations/[id]/example-actions';

const START: ActionState = { status: 'idle' };

/** Take a line out of Examples. The call and the line itself are untouched. */
export function RemoveExample({ momentId, conversationId }: { momentId: string; conversationId: string }) {
  const [state, action, pending] = useActionState(removeExample, START);
  return (
    <form action={action} className="inline-form">
      <input type="hidden" name="momentId" value={momentId} />
      <input type="hidden" name="conversationId" value={conversationId} />
      <button type="submit" className="link-button" disabled={pending}>
        Take out of Examples
      </button>
      {state.status === 'error' ? <span role="alert"> {state.message}</span> : null}
    </form>
  );
}
