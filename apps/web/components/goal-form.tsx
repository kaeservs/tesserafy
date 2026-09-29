'use client';

import { useActionState, useState } from 'react';
import { setGoal, type GoalState } from '@/app/(dashboard)/reports/goal-actions';

const START: GoalState = { status: 'idle' };

/** An owner's goal for one criterion, as a percentage of calls; empty clears it. */
export function GoalForm({
  engagementType,
  criterionKey,
  label,
  target,
}: {
  engagementType: string;
  criterionKey: string;
  label: string;
  /** The current goal, 0 to 1, or null for none. */
  target: number | null;
}) {
  const [value, setValue] = useState(target === null ? '' : String(Math.round(target * 100)));
  const [state, action, pending] = useActionState(setGoal, START);
  const id = `goal-${engagementType}-${criterionKey}`;
  return (
    <form action={action} className="inline-form goal-form">
      <input type="hidden" name="engagementType" value={engagementType} />
      <input type="hidden" name="criterionKey" value={criterionKey} />
      <label htmlFor={id} className="visually-hidden">
        Goal for {label}, percent of calls
      </label>
      <input
        id={id}
        name="target"
        inputMode="numeric"
        size={3}
        placeholder="—"
        value={value}
        onChange={(event) => setValue(event.target.value)}
      />
      %
      <button type="submit" className="link-button" disabled={pending}>
        Set
      </button>
      {state.status === 'error' ? <span role="alert"> {state.message}</span> : null}
    </form>
  );
}
