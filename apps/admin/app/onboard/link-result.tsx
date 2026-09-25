import type { ProvisionState } from './actions';

type Ready = Extract<ProvisionState, { status: 'ready' }>;

/**
 * The one-time link, and what to do with it.
 *
 * Shared by Add people and by answering a request: both end the same way,
 * with a link the operator sends by whatever channel the customer uses. It is
 * valid for an hour — the project's OTP expiry — which it says, because a
 * link that quietly expired overnight reads as a broken product.
 */
export function LinkResult({ state, again }: { state: Ready; again?: { href: string; label: string } }) {
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
          This link will land on <code>{state.landsElsewhere}</code>, not the confirm page it asked
          for. Check the Redirect URLs allow-list in Supabase.
        </p>
      ) : null}
      {state.requestStillOpen ? (
        <p className="tag open" style={{ display: 'block', padding: '0.6rem' }}>
          They are added, but their request could not be closed: {state.requestStillOpen}
        </p>
      ) : null}
      {again ? (
        <p style={{ marginBottom: 0 }}>
          <a className="link" href={again.href}>
            {again.label}
          </a>
        </p>
      ) : null}
    </div>
  );
}
