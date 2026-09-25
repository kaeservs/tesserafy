'use client';

import { useActionState } from 'react';
import { changeRetention, type RetentionState } from '@/app/(dashboard)/settings/actions';
import { PURGE_TIME_UTC, RETENTION_CHOICES, periodLabel } from '@/lib/retention';

const START: RetentionState = { status: 'idle' };

/** Choosing a retention period: review what it deletes, then confirm. */
export function RetentionForm({ current }: { current: number | null }) {
  const [state, action, pending] = useActionState(changeRetention, START);

  if (state.status === 'preview') {
    const { days, affected } = state;
    return (
      <form action={action}>
        <input type="hidden" name="days" value={String(days)} />
        <input type="hidden" name="step" value="confirm" />
        <p role="status">
          {affected === 0
            ? `No calls are older than ${periodLabel(days)} yet, so the next nightly run deletes nothing. `
            : `The next nightly run, at ${PURGE_TIME_UTC}, will delete ${affected} call${affected === 1 ? '' : 's'} older than ${periodLabel(days)}, with everything derived from them. It cannot be undone. `}
          From then on, each call is deleted once it is {periodLabel(days)} old.
        </p>
        {affected > 0 ? (
          <input
            name="confirm"
            aria-label="Type delete to confirm"
            placeholder="Type delete to confirm"
            autoComplete="off"
            required
          />
        ) : null}
        <div className="toolbar">
          <button type="submit" disabled={pending}>
            {pending ? 'Saving…' : `Keep calls for ${periodLabel(days)}`}
          </button>
          {/* A plain link back: the review step is state, not a page. */}
          <a href="/settings">Cancel</a>
        </div>
      </form>
    );
  }

  return (
    <form action={action}>
      <div className="field">
        <label htmlFor="retention-days">Keep calls for</label>
        <select id="retention-days" name="days" defaultValue={current === null ? 'keep' : String(current)}>
          <option value="keep">As long as they are not deleted</option>
          {RETENTION_CHOICES.map((days) => (
            <option key={days} value={String(days)}>
              {periodLabel(days)}
            </option>
          ))}
          {current !== null && !RETENTION_CHOICES.includes(current) ? (
            <option value={String(current)} disabled>
              {periodLabel(current)} (set by support)
            </option>
          ) : null}
        </select>
      </div>
      <div className="toolbar">
        <button type="submit" disabled={pending}>
          {pending ? 'Checking…' : 'Review'}
        </button>
      </div>
      {state.status === 'saved' ? <p role="status">Saved.</p> : null}
      {state.status === 'error' ? <p role="alert">{state.message}</p> : null}
    </form>
  );
}
