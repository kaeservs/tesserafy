'use client';

import { useActionState, useState } from 'react';
import { createCompany, type CreateCompanyState } from './actions';

const START: CreateCompanyState = { status: 'idle' };

/** The last step of signing up: what the company is called. */
export function CreateCompany() {
  const [state, action, pending] = useActionState(createCompany, START);
  const [name, setName] = useState('');

  return (
    <form action={action} className="card">
      <div className="field">
        <label htmlFor="company-name">Company name</label>
        <input
          id="company-name"
          name="name"
          required
          minLength={2}
          maxLength={100}
          autoComplete="organization"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </div>
      <button type="submit" disabled={pending}>
        {pending ? 'Creating…' : 'Create company and start the trial'}
      </button>
      {state.status === 'error' ? <p role="alert">{state.message}</p> : null}
    </form>
  );
}
