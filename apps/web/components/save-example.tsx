'use client';

import { useActionState, useEffect, useState } from 'react';
import { saveExample, type ActionState } from '@/app/(dashboard)/conversations/[id]/example-actions';

const START: ActionState = { status: 'idle' };

export interface CriterionOption {
  readonly key: string;
  readonly label: string;
}

/**
 * Save one line of a call to Examples, under the criterion it shows being met,
 * with a word on why. The list is this call's own scorecard, so an example is
 * always of something the product scores.
 */
export function SaveExample({
  conversationId,
  segmentId,
  criteria,
  savedAs,
}: {
  conversationId: string;
  segmentId: string;
  criteria: readonly CriterionOption[];
  /** Labels of the criteria this line is already an example of. */
  savedAs: readonly string[];
}) {
  const [open, setOpen] = useState(false);
  const [criterion, setCriterion] = useState(criteria[0]?.key ?? '');
  const [note, setNote] = useState('');
  const [state, action, pending] = useActionState(saveExample, START);

  useEffect(() => {
    if (state.status === 'saved') {
      setOpen(false);
      setNote('');
    }
  }, [state]);

  if (criteria.length === 0) return null;

  return (
    <div className="save-example">
      {savedAs.length > 0 ? <span className="muted">Example of {savedAs.join(', ')}. </span> : null}
      {open ? (
        <form action={action}>
          <input type="hidden" name="conversationId" value={conversationId} />
          <input type="hidden" name="segmentId" value={segmentId} />
          <div className="field">
            <label htmlFor={`example-criterion-${segmentId}`}>An example of</label>
            <select id={`example-criterion-${segmentId}`} name="criterion" value={criterion} onChange={(event) => setCriterion(event.target.value)}>
              {criteria.map((option) => (
                <option key={option.key} value={option.key}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor={`example-note-${segmentId}`}>Why it is a good one (optional)</label>
            <input id={`example-note-${segmentId}`} name="note" maxLength={500} value={note} onChange={(event) => setNote(event.target.value)} />
          </div>
          <div className="toolbar">
            <button type="submit" disabled={pending}>
              Save example
            </button>
            <button type="button" onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <button type="button" className="link-button" onClick={() => setOpen(true)}>
          Save as an example
        </button>
      )}
      {state.status === 'saved' ? (
        <span role="status" className="muted">
          {' '}
          {state.message}
        </span>
      ) : null}
      {state.status === 'error' ? (
        <span role="alert">
          {' '}
          {state.message}
        </span>
      ) : null}
    </div>
  );
}
