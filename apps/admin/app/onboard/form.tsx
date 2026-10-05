'use client';

import { useActionState, useState } from 'react';
import { provisionAccount, type ProvisionState } from './actions';
import { LinkResult } from './link-result';

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
export interface Prefill {
  readonly email?: string;
  readonly companyName?: string;
  readonly plan?: string;
  /** The early-access entry this invites, marked invited once they are added. */
  readonly earlyAccess?: string;
}

/** Plans a company can be started on here, cheapest first. */
const PLANS = [
  ['free', 'free'],
  ['trial', 'trial'],
  ['basic', 'basic (Starter)'],
  ['pro', 'pro'],
  ['incognito', 'incognito'],
  ['pilot', 'pilot'],
  ['internal', 'internal'],
] as const;

export function ProvisionForm({ companies, prefill = {} }: { companies: { id: string; name: string }[]; prefill?: Prefill }) {
  const [state, action, pending] = useActionState(provisionAccount, START);
  const [target, setTarget] = useState('new');
  // Held here so a refused attempt keeps what was typed: React resets a
  // form's uncontrolled fields after every action.
  const [email, setEmail] = useState(prefill.email ?? '');
  const [companyName, setCompanyName] = useState(prefill.companyName ?? '');
  // The selects too: reset to their defaults, a retried "paid" would quietly
  // go through as "pilot".
  const [plan, setPlan] = useState(prefill.plan ?? 'pilot');
  const [role, setRole] = useState('member');

  if (state.status === 'ready') {
    return <LinkResult state={state} again={{ href: '/onboard', label: 'Add someone else →' }} />;
  }

  return (
    <form action={action} className="card">
      {prefill.earlyAccess ? (
        <>
          <input type="hidden" name="earlyAccess" value={prefill.earlyAccess} />
          <p className="muted" style={{ marginTop: 0 }}>
            From the early-access list: a new company on Free with them as its owner, and marked invited once they are added.
            Send them the link.
          </p>
        </>
      ) : null}
      <div className="row">
        <div>
          <label htmlFor="email">Email</label>
          <input
            id="email"
            name="email"
            type="email"
            required
            autoComplete="off"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
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
            <input
              id="companyName"
              name="companyName"
              required
              autoComplete="off"
              value={companyName}
              onChange={(event) => setCompanyName(event.target.value)}
            />
          </div>
          <div className="narrow">
            <label htmlFor="plan">Plan</label>
            <select
              id="plan"
              name="plan"
              value={plan}
              onChange={(event) => setPlan(event.target.value)}
            >
              {PLANS.map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
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
            <select
              id="role"
              name="role"
              value={role}
              onChange={(event) => setRole(event.target.value)}
            >
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
