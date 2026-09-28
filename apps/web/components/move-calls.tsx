'use client';

import { useActionState } from 'react';
import { moveCallsToNewest, type MoveState } from '@/app/(dashboard)/scorecards/actions';

const START: MoveState = { status: 'idle' };
const BATCH = 10;

/**
 * Moving calls scored on an older version onto the newest one.
 *
 * Says what it costs before it is pressed — each call is scored again and
 * counts as an imported call — because it is the one button on this page that
 * spends the plan and removes evidence.
 */
export function MoveCalls({ name, newest, onOlder }: { name: string; newest: number; onOlder: number }) {
  const [state, move, moving] = useActionState(moveCallsToNewest, START);
  const left = state.status === 'moved' ? state.remaining : onOlder;
  const next = Math.min(BATCH, left);

  return (
    <div className="card" style={{ marginTop: '1rem' }}>
      {left > 0 ? (
        <p style={{ marginTop: 0 }}>
          <strong>
            {left} call{left === 1 ? ' is' : 's are'} still scored against an older version.
          </strong>{' '}
          Moving a call scores it again against version {newest}: the evidence behind its current score is
          replaced, and it counts as one imported call on your plan. Ten at a time.
        </p>
      ) : (
        <p style={{ marginTop: 0 }} className="muted">
          Every call on this scorecard is on version {newest}.
        </p>
      )}
      {left > 0 ? (
        <form action={move}>
          <input type="hidden" name="name" value={name} />
          <button type="submit" disabled={moving}>
            {moving ? 'Moving…' : `Move ${next} call${next === 1 ? '' : 's'} to version ${newest}`}
          </button>
        </form>
      ) : null}
      {state.status === 'moved' ? <p role="status">{state.message}</p> : null}
      {state.status === 'error' ? <p role="alert">{state.message}</p> : null}
    </div>
  );
}
