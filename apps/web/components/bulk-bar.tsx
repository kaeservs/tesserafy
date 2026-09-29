'use client';

import { startTransition, useActionState, useEffect, useState } from 'react';
import { bulkMeetings, type BulkState } from '@/app/(dashboard)/conversations/bulk-actions';
import { BULK_FORM } from '@/lib/bulk';

const START: BulkState = { status: 'idle' };

/**
 * The bar for acting on several meetings. The checkboxes live in the list,
 * joined to this form by its id (HTML's form attribute), so the list stays
 * server-rendered and this is the only part that runs in the browser.
 */
export function BulkBar({ accounts, mayDelete }: { accounts: readonly { id: string; name: string }[]; mayDelete: boolean }) {
  const [selected, setSelected] = useState(0);
  const [operation, setOperation] = useState<'account' | 'delete'>('account');
  const [accountId, setAccountId] = useState('');
  const [newAccount, setNewAccount] = useState('');
  const [confirm, setConfirm] = useState('');
  const [state, action, pending] = useActionState(bulkMeetings, START);

  useEffect(() => {
    const count = () => setSelected(document.querySelectorAll(`input[form="${BULK_FORM}"][name="ids"]:checked`).length);
    count();
    document.addEventListener('change', count);
    return () => document.removeEventListener('change', count);
  }, []);

  useEffect(() => {
    if (state.status !== 'done') return;
    for (const box of document.querySelectorAll<HTMLInputElement>(`input[form="${BULK_FORM}"][name="ids"]`)) box.checked = false;
    setSelected(0);
    setConfirm('');
  }, [state]);

  return (
    // Submitted by hand, not through the form's action: React resets every
    // control in a form after its action runs, and the checkboxes belong to
    // this form, so a refused attempt would silently untick them all.
    <form
      id={BULK_FORM}
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        startTransition(() => action(data));
      }}
      className="bulk-bar card"
      aria-label="Act on the chosen meetings"
    >
      <span>
        <strong>{selected}</strong> chosen
      </span>
      <label className="visually-hidden" htmlFor="bulk-operation">
        What to do
      </label>
      <select id="bulk-operation" name="operation" value={operation} onChange={(event) => setOperation(event.target.value as 'account' | 'delete')}>
        <option value="account">Set the customer</option>
        {mayDelete ? <option value="delete">Delete</option> : null}
      </select>
      {operation === 'account' ? (
        <>
          <label className="visually-hidden" htmlFor="bulk-account">
            Customer
          </label>
          <select id="bulk-account" name="accountId" value={accountId} onChange={(event) => setAccountId(event.target.value)}>
            <option value="">A new customer…</option>
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
          </select>
          {accountId === '' ? (
            <input
              name="newAccount"
              aria-label="New customer's name"
              placeholder="New customer's name"
              maxLength={120}
              value={newAccount}
              onChange={(event) => setNewAccount(event.target.value)}
            />
          ) : null}
        </>
      ) : (
        <input
          name="confirm"
          aria-label="Type delete to confirm"
          placeholder="Type delete to confirm"
          autoComplete="off"
          value={confirm}
          onChange={(event) => setConfirm(event.target.value)}
        />
      )}
      <button type="submit" disabled={pending || selected === 0}>
        {pending ? 'Working…' : operation === 'delete' ? `Delete ${selected}` : 'Apply'}
      </button>
      {state.status === 'done' ? <span role="status">{state.message}</span> : null}
      {state.status === 'error' ? <span role="alert">{state.message}</span> : null}
    </form>
  );
}
