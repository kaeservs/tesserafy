'use client';

import { useActionState } from 'react';
import { markSpeaker, type ActionState } from '@/app/(dashboard)/conversations/[id]/example-actions';

const START: ActionState = { status: 'idle' };

/**
 * "This is one of us", beside a speaker in Who talked. Marking a name once
 * marks it on every call, so the split between your side and the customer's
 * appears everywhere that name speaks.
 */
export function OurSpeaker({ conversationId, speaker, ours }: { conversationId: string; speaker: string; ours: boolean }) {
  const [state, action, pending] = useActionState(markSpeaker, START);
  return (
    <form action={action} className="inline-form">
      <input type="hidden" name="conversationId" value={conversationId} />
      <input type="hidden" name="speaker" value={speaker} />
      <input type="hidden" name="ours" value={ours ? 'no' : 'yes'} />
      <button type="submit" className="link-button" disabled={pending} aria-label={ours ? `${speaker} is not one of ours` : `${speaker} is one of ours`}>
        {ours ? 'Not ours' : 'One of ours'}
      </button>
      {state.status === 'error' ? (
        <span role="alert">
          {' '}
          {state.message}
        </span>
      ) : null}
    </form>
  );
}
