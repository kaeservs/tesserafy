'use client';

import { useActionState, useState } from 'react';
import { editCall, type EditState } from '@/app/(dashboard)/conversations/[id]/call-actions';

const START: EditState = { status: 'idle' };

export interface ScorecardChoice {
  readonly value: string;
  readonly label: string;
}

/**
 * Correcting a call: its title, date, scorecard and how the deal stood.
 *
 * Closed by default — most visits are to read a call, not fix it. A changed
 * scorecard says what it will cost before it is saved, because it is the one
 * change here that removes something and spends something.
 */
export function EditCall({
  conversationId,
  title,
  date,
  scorecard,
  outcome,
  scorecards,
  account,
  accounts,
}: {
  conversationId: string;
  title: string;
  date: string;
  scorecard: string;
  outcome: string;
  scorecards: readonly ScorecardChoice[];
  account: string;
  accounts: readonly string[];
}) {
  const [state, save, saving] = useActionState(editCall, START);
  const [chosen, setChosen] = useState(scorecard);

  return (
    <details className="card edit-call">
      <summary>Edit this call</summary>
      <form action={save}>
        <input type="hidden" name="conversationId" value={conversationId} />
        <div className="field">
          <label htmlFor="edit-title">Title</label>
          <input id="edit-title" name="title" defaultValue={title} maxLength={200} required />
        </div>
        <div className="field">
          <label htmlFor="edit-date">Date of the call</label>
          <input id="edit-date" name="date" type="date" defaultValue={date} />
        </div>
        <div className="field">
          <label htmlFor="edit-account">Who it was with</label>
          <input id="edit-account" name="account" list="edit-account-names" defaultValue={account} maxLength={120} placeholder="Acme Robotics" />
          <datalist id="edit-account-names">
            {accounts.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
        </div>
        <div className="field">
          <label htmlFor="edit-outcome">How the deal stood after it</label>
          <select id="edit-outcome" name="outcome" defaultValue={outcome}>
            <option value="unknown">Not said</option>
            <option value="open">Still open</option>
            <option value="won">Won</option>
            <option value="lost">Lost</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="edit-scorecard">Scorecard</label>
          <select
            id="edit-scorecard"
            name="scorecard"
            value={chosen}
            onChange={(event) => setChosen(event.target.value)}
          >
            {scorecards.map((choice) => (
              <option key={choice.value} value={choice.value}>
                {choice.label}
              </option>
            ))}
          </select>
        </div>
        {chosen !== scorecard ? (
          <p role="status" className="muted">
            Changing the scorecard scores this call again from its transcript. The evidence behind
            its current score is removed, and it counts as one imported call on your plan.
          </p>
        ) : null}
        <button type="submit" disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </button>
        {state.status === 'error' ? <p role="alert">{state.message}</p> : null}
        {state.status === 'saved' ? <p role="status">{state.message}</p> : null}
      </form>
    </details>
  );
}
