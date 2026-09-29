'use client';

import { useActionState, useState } from 'react';
import { deleteAccounts, type DeleteState } from '../actions';

const START: DeleteState = { status: 'idle' };

export interface Candidate {
  userId: string;
  email: string;
  joined: string;
  lastSeen: string;
}

const RESULT_LABEL = { deleted: 'deleted', refused: 'not deleted', unfinished: 'did not finish' } as const;

/**
 * Which accounts, why, and the confirmation typed back.
 *
 * Every field is held in state: React resets a form's uncontrolled fields
 * after an action, and a refused attempt should not untick the list or clear
 * the reason. The outcome stays above the form, which stays mounted, so the
 * page refreshing after a deletion does not take the result with it.
 */
export function DeleteForm({ candidates, defaultReason }: { candidates: Candidate[]; defaultReason: string }) {
  const [state, action, pending] = useActionState(deleteAccounts, START);
  const [ticked, setTicked] = useState<Set<string>>(() => new Set(candidates.map((c) => c.userId)));
  const [reason, setReason] = useState(defaultReason);
  const [confirm, setConfirm] = useState('');

  const chosen = candidates.filter((c) => ticked.has(c.userId));
  const expected = chosen.length === 1 ? chosen[0]!.email : String(chosen.length);

  function toggle(id: string) {
    setTicked((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setConfirm('');
  }

  return (
    <>
      {state.status === 'done' ? (
        <div className="card" role="status">
          <p style={{ marginTop: 0 }}>
            {state.outcomes.filter((o) => o.result === 'deleted').length} of {state.outcomes.length} deleted.
          </p>
          <ul style={{ marginBottom: 0 }}>
            {state.outcomes.map((outcome) => (
              <li key={outcome.email}>
                {outcome.email} — <strong>{RESULT_LABEL[outcome.result]}</strong>
                {outcome.message ? <span className="muted"> · {outcome.message}</span> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {candidates.length === 0 ? (
        // After a deletion the list empties because it worked; saying "none can
        // be deleted" then reads like a failure.
        state.status === 'done' ? null : <p className="muted">No account here can be deleted.</p>
      ) : (
        <form action={action} className="card">
          <table tabIndex={0}>
            <thead>
              <tr>
                <th />
                <th>Email</th>
                <th>Joined</th>
                <th>Last seen</th>
              </tr>
            </thead>
            <tbody>
              {candidates.map((candidate) => (
                <tr key={candidate.userId}>
                  <td>
                    <input
                      type="checkbox"
                      name="id"
                      value={candidate.userId}
                      checked={ticked.has(candidate.userId)}
                      onChange={() => toggle(candidate.userId)}
                      aria-label={`Delete ${candidate.email}`}
                    />
                  </td>
                  <td>{candidate.email}</td>
                  <td className="muted">{candidate.joined}</td>
                  <td className="muted">{candidate.lastSeen}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="row" style={{ marginTop: '0.8rem' }}>
            <div>
              <label htmlFor="reason">Reason</label>
              <input
                id="reason"
                name="reason"
                required
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="synthetic test accounts · erasure request, ticket 14"
              />
            </div>
          </div>
          <p className="muted" style={{ margin: '0.3rem 0 0' }}>
            Kept with the record, which operators can read. Leave the address out of it: the record
            keeps only a fingerprint of the address, so that it can be recognised if asked about, not
            read.
          </p>

          <div className="row" style={{ marginTop: '0.6rem' }}>
            <div>
              <label htmlFor="confirm">
                {chosen.length === 1
                  ? `Type the address to confirm: ${expected}`
                  : `Type the number of accounts ticked to confirm: ${expected}`}
              </label>
              <input
                id="confirm"
                name="confirm"
                required
                autoComplete="off"
                value={confirm}
                onChange={(event) => setConfirm(event.target.value)}
              />
            </div>
          </div>

          {state.status === 'error' ? <p className="tag open">{state.message}</p> : null}

          <div className="row" style={{ marginTop: '0.8rem' }}>
            <div className="go">
              <button type="submit" className="danger" disabled={pending || chosen.length === 0}>
                {pending
                  ? 'Deleting…'
                  : chosen.length === 1
                    ? 'Delete this account'
                    : `Delete ${chosen.length} accounts`}
              </button>
            </div>
          </div>
        </form>
      )}
    </>
  );
}
