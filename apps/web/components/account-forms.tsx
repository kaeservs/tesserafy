'use client';

import { useActionState, useState } from 'react';
import {
  addAccount,
  deleteAccount,
  renameAccount,
  type AccountState,
} from '@/app/(dashboard)/accounts/actions';

const START: AccountState = { status: 'idle' };

/** Adding an account by hand, for a brief before the first call. */
export function AddAccount() {
  const [state, add, adding] = useActionState(addAccount, START);
  return (
    <form action={add} className="filters" aria-label="Add an account">
      <div className="field">
        <label htmlFor="account-name">Customer</label>
        <input id="account-name" name="name" maxLength={120} placeholder="Acme Robotics" required />
      </div>
      <div className="field">
        <label htmlFor="account-domain">Website (optional)</label>
        <input id="account-domain" name="domain" maxLength={120} placeholder="acme.com" />
      </div>
      <div className="toolbar filter-actions">
        <button type="submit" disabled={adding}>
          {adding ? 'Adding…' : 'Add account'}
        </button>
      </div>
      {state.status === 'error' ? <p role="alert">{state.message}</p> : null}
    </form>
  );
}

/** Renaming, for an owner or whoever added it; deleting, for an owner. */
export function ManageAccount({
  accountId,
  name,
  domain,
  mayRename,
  mayDelete,
  calls,
}: {
  accountId: string;
  name: string;
  domain: string | null;
  mayRename: boolean;
  mayDelete: boolean;
  calls: number;
}) {
  const [renamed, rename, renaming] = useActionState(renameAccount, START);
  const [deleted, remove, removing] = useActionState(deleteAccount, START);
  const [confirming, setConfirming] = useState(false);
  if (!mayRename && !mayDelete) return null;

  return (
    <details className="card edit-call">
      <summary>Manage this account</summary>
      {mayRename ? (
        <form action={rename} style={{ marginTop: '0.75rem' }}>
          <input type="hidden" name="accountId" value={accountId} />
          <div className="field">
            <label htmlFor="rename-name">Name</label>
            <input id="rename-name" name="name" defaultValue={name} maxLength={120} required />
          </div>
          <div className="field">
            <label htmlFor="rename-domain">Website</label>
            <input id="rename-domain" name="domain" defaultValue={domain ?? ''} maxLength={120} />
          </div>
          <button type="submit" disabled={renaming}>
            Save
          </button>
          {renamed.status === 'saved' ? <p role="status">Saved.</p> : null}
          {renamed.status === 'error' ? <p role="alert">{renamed.message}</p> : null}
        </form>
      ) : null}
      {mayDelete ? (
        <form action={remove} style={{ marginTop: '1rem' }}>
          <input type="hidden" name="accountId" value={accountId} />
          <p className="muted">
            Deleting the account keeps its {calls} call{calls === 1 ? '' : 's'}; they are no longer linked to a
            customer.
          </p>
          {confirming ? (
            <div className="toolbar">
              <button type="submit" disabled={removing}>
                Yes, delete {name}
              </button>
              <button type="button" onClick={() => setConfirming(false)}>
                Cancel
              </button>
            </div>
          ) : (
            <button type="button" onClick={() => setConfirming(true)}>
              Delete account
            </button>
          )}
          {deleted.status === 'error' ? <p role="alert">{deleted.message}</p> : null}
        </form>
      ) : null}
    </details>
  );
}
