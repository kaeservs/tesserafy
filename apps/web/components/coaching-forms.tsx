'use client';

import { useActionState, useEffect, useState } from 'react';
import { assignCoaching, completeCoaching, type CoachingState } from '@/app/(dashboard)/coaching/actions';

const START: CoachingState = { status: 'idle' };

/**
 * On a call, for an owner: send a teammate this call, or one moment in it, to
 * listen to, with a note on what to listen for. Fields held in state, as
 * React resets a form after its action.
 */
export function AssignCoaching({
  conversationId,
  people,
  moments,
}: {
  conversationId: string;
  people: readonly { id: string; label: string }[];
  moments: readonly { id: string; label: string }[];
}) {
  const [assignedTo, setAssignedTo] = useState(people[0]?.id ?? '');
  const [segmentId, setSegmentId] = useState('');
  const [note, setNote] = useState('');
  const [state, action, pending] = useActionState(assignCoaching, START);

  useEffect(() => {
    if (state.status === 'saved') setNote('');
  }, [state]);

  if (people.length === 0) return null;
  return (
    <details className="card coaching-assign">
      <summary>Assign for coaching</summary>
      <form action={action}>
        <input type="hidden" name="conversationId" value={conversationId} />
        <div className="field">
          <label htmlFor="coach-person">Who should listen</label>
          <select id="coach-person" name="assignedTo" value={assignedTo} onChange={(event) => setAssignedTo(event.target.value)}>
            {people.map((person) => (
              <option key={person.id} value={person.id}>
                {person.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="coach-moment">From which moment</label>
          <select id="coach-moment" name="segmentId" value={segmentId} onChange={(event) => setSegmentId(event.target.value)}>
            <option value="">The whole call</option>
            {moments.map((moment) => (
              <option key={moment.id} value={moment.id}>
                {moment.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="coach-note">What to listen for (optional)</label>
          <textarea id="coach-note" name="note" rows={3} maxLength={1000} value={note} onChange={(event) => setNote(event.target.value)} />
        </div>
        <button type="submit" disabled={pending || !assignedTo}>
          {pending ? 'Assigning…' : 'Assign'}
        </button>
        {state.status === 'saved' ? <p role="status">{state.message}</p> : null}
        {state.status === 'error' ? <p role="alert">{state.message}</p> : null}
      </form>
    </details>
  );
}

/** For the seller it was assigned to: done, with an optional line back. */
export function CompleteCoaching({ assignmentId }: { assignmentId: string }) {
  const [reply, setReply] = useState('');
  const [state, action, pending] = useActionState(completeCoaching, START);
  return (
    <form action={action} className="coaching-complete">
      <input type="hidden" name="assignmentId" value={assignmentId} />
      <label className="visually-hidden" htmlFor={`reply-${assignmentId}`}>
        A line back (optional)
      </label>
      <input
        id={`reply-${assignmentId}`}
        name="reply"
        maxLength={1000}
        placeholder="A line back (optional)"
        value={reply}
        onChange={(event) => setReply(event.target.value)}
      />
      <button type="submit" disabled={pending}>
        {pending ? 'Saving…' : 'Mark done'}
      </button>
      {state.status === 'error' ? <span role="alert"> {state.message}</span> : null}
    </form>
  );
}
