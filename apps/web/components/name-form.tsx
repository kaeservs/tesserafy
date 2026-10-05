'use client';

import { useActionState, useState } from 'react';
import { saveName, type NameState } from '@/app/(dashboard)/profile/actions';

const START: NameState = { status: 'idle' };

/** Your name, kept as typed until it is saved. */
export function NameForm({ name }: { name: string }) {
  const [state, save, saving] = useActionState(saveName, START);
  const [value, setValue] = useState(name);
  return (
    <form action={save} className="toolbar">
      <label htmlFor="profile-name">Your name</label>
      <input id="profile-name" name="name" value={value} onChange={(event) => setValue(event.target.value)} maxLength={100} autoComplete="name" />
      <button type="submit" disabled={saving || value.trim() === name}>
        {saving ? 'Saving…' : 'Save'}
      </button>
      {state.status === 'saved' ? <span role="status" className="muted">Saved.</span> : null}
      {state.status === 'error' ? <span role="alert">{state.message}</span> : null}
    </form>
  );
}
