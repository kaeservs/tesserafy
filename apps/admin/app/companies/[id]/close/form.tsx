'use client';

import { useActionState, useState } from 'react';
import { closeCompany, type CloseState } from '../../actions';

const START: CloseState = { status: 'idle' };

/**
 * The reason, the name typed back, and a button that says what it does.
 *
 * The result lists any tickets already exported to a tracker. Their bodies
 * quote the customer and live outside this system, so closing cannot reach
 * them; a person has to, and the list is how they know where.
 */
export function CloseForm({
  companyId,
  name,
  closed,
}: {
  companyId: string;
  name: string;
  closed: boolean;
}) {
  const [state, action, pending] = useActionState(closeCompany, START);
  // Held here rather than left to the inputs: React resets a form's
  // uncontrolled fields after every action, so a refused attempt used to
  // clear the reason, and the next press was blocked by `required` without
  // saying why.
  const [reason, setReason] = useState('');
  const [confirmName, setConfirmName] = useState('');

  if (state.status === 'closed') {
    return (
      <div className="card">
        <p style={{ marginTop: 0 }}>
          <strong>{name}</strong> is closed. {state.callsErased} call
          {state.callsErased === 1 ? '' : 's'} erased, {state.peopleRemoved}{' '}
          {state.peopleRemoved === 1 ? 'person' : 'people'} removed.
        </p>
        {state.exportedTickets.length > 0 ? (
          <div className="tag open" style={{ display: 'block', padding: '0.6rem' }}>
            <p style={{ marginTop: 0 }}>
              These tickets were exported earlier and quote their calls. They live in the tracker
              and were not deleted — delete them there:
            </p>
            <ul style={{ marginBottom: 0 }}>
              {state.exportedTickets.map((ticket) => (
                <li key={ticket.url}>
                  <a className="link" href={ticket.url} target="_blank" rel="noreferrer">
                    {ticket.url}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="muted">No tickets had been exported from it.</p>
        )}
        <p style={{ marginBottom: 0 }}>
          <a className="link" href="/companies">
            ← Companies
          </a>
        </p>
      </div>
    );
  }

  // Closed before this visit: the page above says when; nothing to offer.
  if (closed) return null;

  return (
    <form action={action} className="card">
      <input type="hidden" name="companyId" value={companyId} />
      <div className="row">
        <div>
          <label htmlFor="reason">Reason</label>
          <input
            id="reason"
            name="reason"
            required
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="pilot ended 30 Sept, deletion requested"
          />
        </div>
      </div>
      <div className="row" style={{ marginTop: '0.6rem' }}>
        <div>
          <label htmlFor="confirmName">Type the company name to confirm: {name}</label>
          <input
            id="confirmName"
            name="confirmName"
            required
            autoComplete="off"
            value={confirmName}
            onChange={(event) => setConfirmName(event.target.value)}
          />
        </div>
      </div>
      <div className="row" style={{ marginTop: '0.8rem' }}>
        <div className="go">
          <button type="submit" className="danger" disabled={pending}>
            {pending ? 'Closing…' : 'Close this company and erase everything'}
          </button>
        </div>
      </div>
      {state.status === 'error' ? (
        <p className="tag open" role="alert" style={{ display: 'block', padding: '0.6rem' }}>
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
