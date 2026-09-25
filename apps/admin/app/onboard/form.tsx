'use client';

import { useActionState, useState } from 'react';
import { provisionAccount, type ProvisionState } from './actions';

const START: ProvisionState = { status: 'idle' };

/**
 * Who, and where.
 *
 * The result is a link for the operator to send, not an email this app
 * sends: there is no email provider yet, and a link in the operator's hands
 * can go by whatever channel the pilot is already talking on. It is valid for
 * an hour — the project's OTP expiry — which the result says, because a link
 * that quietly expired overnight reads to the customer as a broken product.
 */
export function ProvisionForm({ companies }: { companies: { id: string; name: string }[] }) {
  const [state, action, pending] = useActionState(provisionAccount, START);
  const [target, setTarget] = useState('new');

  if (state.status === 'ready') {
    return (
      <div className="card">
        <p style={{ marginTop: 0 }}>
          {state.newAccount ? 'Account created' : 'Existing account added'} for{' '}
          <strong>{state.email}</strong>. Recorded as <code>{state.recordId}</code>.
        </p>
        <p>Send them this link. It signs them in once and is valid for one hour:</p>
        <p>
          <code>{state.link}</code>
        </p>
        <p className="muted">
          {state.newAccount
            ? 'It takes them to “choose a password”, so they can sign in again without email.'
            : 'They already have an account, so it signs them in and takes them to their calls.'}{' '}
          Do not open it yourself: it would sign this browser in as them, and the link would be
          spent.
        </p>
        {state.landsElsewhere ? (
          <p className="tag open" style={{ display: 'block', padding: '0.6rem' }}>
            This link will land on <code>{state.landsElsewhere}</code>, not the confirm page it
            asked for. Check the Redirect URLs allow-list in Supabase.
          </p>
        ) : null}
        <p style={{ marginBottom: 0 }}>
          <a className="link" href="/onboard">
            Add someone else →
          </a>
        </p>
      </div>
    );
  }

  return (
    <form action={action} className="card">
      <div className="row">
        <div>
          <label htmlFor="email">Email</label>
          <input id="email" name="email" type="email" required autoComplete="off" />
        </div>
        <div>
          <label htmlFor="target">Company</label>
          <select
            id="target"
            name="target"
            value={target}
            onChange={(event) => setTarget(event.target.value)}
          >
            <option value="new">A new company…</option>
            {companies.map((company) => (
              <option key={company.id} value={company.id}>
                {company.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {target === 'new' ? (
        <div className="row" style={{ marginTop: '0.6rem' }}>
          <div>
            <label htmlFor="companyName">Company name</label>
            <input id="companyName" name="companyName" required autoComplete="off" />
          </div>
          <div className="narrow">
            <label htmlFor="plan">Plan (label)</label>
            <select id="plan" name="plan" defaultValue="pilot">
              <option value="pilot">pilot</option>
              <option value="trial">trial</option>
              <option value="paid">paid</option>
              <option value="internal">internal</option>
            </select>
          </div>
          <div className="go">
            <p className="muted" style={{ margin: 0 }}>
              They will be its owner.
            </p>
          </div>
        </div>
      ) : (
        <div className="row" style={{ marginTop: '0.6rem' }}>
          <div className="narrow">
            <label htmlFor="role">Role</label>
            <select id="role" name="role" defaultValue="member">
              <option value="member">member</option>
              <option value="owner">owner</option>
            </select>
          </div>
        </div>
      )}

      <div className="row" style={{ marginTop: '0.8rem' }}>
        <div className="go">
          <button type="submit" disabled={pending}>
            {pending ? 'Adding…' : 'Add and make a sign-in link'}
          </button>
        </div>
      </div>
      {state.status === 'error' ? (
        <p className="tag open" role="alert" style={{ display: 'block', padding: '0.6rem' }}>
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
