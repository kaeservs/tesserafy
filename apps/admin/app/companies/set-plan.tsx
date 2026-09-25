'use client';

import { useActionState, useState } from 'react';
import { setPlan, type SetPlanState } from './actions';

const START: SetPlanState = { status: 'idle' };

const PLANS = ['trial', 'basic', 'pro', 'pilot', 'internal', 'none'] as const;

/**
 * Put a company on any plan, now: a pilot granted, a plan comped, a trial
 * restarted. Recorded as the operator in the company's plan history, which
 * its owners can read.
 */
export function SetPlan({ companyId, current }: { companyId: string; current: string }) {
  const [state, action, pending] = useActionState(setPlan, START);
  const [plan, setChoice] = useState(current);

  return (
    <form action={action} className="row" style={{ flexWrap: 'nowrap', gap: '0.3rem' }}>
      <input type="hidden" name="companyId" value={companyId} />
      <select
        name="plan"
        aria-label="Plan"
        value={plan}
        onChange={(event) => setChoice(event.target.value)}
        style={{ width: '7rem' }}
      >
        {PLANS.map((id) => (
          <option key={id} value={id}>
            {id}
          </option>
        ))}
      </select>
      <button type="submit" disabled={pending || plan === current}>
        {pending ? '…' : 'Set'}
      </button>
      {state.status === 'error' ? (
        <span className="tag open" role="alert">
          {state.message}
        </span>
      ) : null}
    </form>
  );
}
