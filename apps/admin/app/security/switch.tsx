'use client';

import { useActionState } from 'react';
import { setRequired, type SwitchState } from './actions';

const START: SwitchState = { status: 'idle' };

/** The switch, with the reason it cannot move when it cannot. */
export function RequireSwitch({ required, ready }: { required: boolean; ready: boolean }) {
  const [state, flip, pending] = useActionState(setRequired, START);
  return (
    <form action={flip}>
      <input type="hidden" name="required" value={required ? 'false' : 'true'} />
      <button type="submit" disabled={pending || (!required && !ready)}>
        {required ? 'Stop requiring it' : 'Require two-step sign-in'}
      </button>
      {!required && !ready ? (
        <p className="muted">Everyone listed below needs an authenticator before this can be turned on.</p>
      ) : null}
      {state.status === 'error' ? <p className="tag open">{state.message}</p> : null}
    </form>
  );
}
