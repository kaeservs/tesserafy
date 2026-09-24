'use client';

import { useActionState } from 'react';
import { eraseConversation, type EraseState } from '@/app/(dashboard)/conversations/[id]/actions';

const START: EraseState = { status: 'idle' };

/** Deleting a call: irreversible, owner-only, and said plainly. */
export function DeleteCall({ conversationId }: { conversationId: string }) {
  const [state, action, pending] = useActionState(eraseConversation, START);

  return (
    <section aria-labelledby="delete-heading" className="card">
      <h2 id="delete-heading" style={{ marginTop: 0 }}>
        Delete this call
      </h2>
      <p className="muted">
        Removes the transcript and everything derived from it — the scorecard, signals, search
        index, and any insight that was only backed by this call. It cannot be undone. A record
        that it was deleted, and by whom, is kept; its contents are not.
      </p>
      <form action={action} className="toolbar">
        <input type="hidden" name="conversationId" value={conversationId} />
        <input
          name="confirm"
          aria-label="Type delete to confirm"
          placeholder="Type delete to confirm"
          autoComplete="off"
          required
        />
        <button type="submit" disabled={pending}>
          {pending ? 'Deleting…' : 'Delete call'}
        </button>
      </form>
      {state.status === 'error' ? <p role="alert">{state.message}</p> : null}
    </section>
  );
}
