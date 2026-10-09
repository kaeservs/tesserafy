'use client';

import { useActionState, useState } from 'react';
import { setPlan, type SetPlanState } from './actions';

const START: SetPlanState = { status: 'idle' };

/**
 * Put a company on any plan, now: a pilot granted, a plan comped, a trial
 * restarted. Recorded as the operator in the company's plan history, which
 * its owners can read. The plans offered are the `plans` table's, in its
 * order, so a plan added to the catalogue can be given without a deploy.
 */
export function SetPlan({
  companyId,
  current,
  plans,
}: {
  companyId: string;
  current: string;
  plans: readonly { id: string; name: string }[];
}) {
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
        style={{ width: '9rem' }}
      >
        {plans.map((plan) => (
          <option key={plan.id} value={plan.id}>
            {plan.name}
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
