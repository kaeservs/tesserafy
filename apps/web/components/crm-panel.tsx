'use client';

import { useActionState, useEffect, useState } from 'react';
import { connectCrm, disconnectCrm, type CrmState } from '@/app/(dashboard)/settings/crm-actions';

const START: CrmState = { status: 'idle' };

export interface ConnectedCrm {
  accountRef: string;
  tokenHint: string;
  connectedBy: string | null;
  lastError: string | null;
}

/**
 * Where calls are logged: the company's HubSpot (ADR 0024).
 *
 * The token field is a password field held in state only until it is sent;
 * the token is never shown again, only its last four characters. Replacing
 * it is connecting again. Disconnecting takes two clicks.
 */
export function CrmPanel({
  connected,
  isOwner,
  available,
  connectedDate,
}: {
  connected: ConnectedCrm | null;
  isOwner: boolean;
  available: boolean;
  connectedDate: string | null;
}) {
  const [state, connect, connecting] = useActionState(connectCrm, START);
  const [, disconnect, disconnecting] = useActionState(disconnectCrm, START);
  const [token, setToken] = useState('');
  const [replacing, setReplacing] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);

  // Once it is stored the token has no business staying in the page.
  useEffect(() => {
    if (state.status !== 'connected') return;
    setToken('');
    setReplacing(false);
  }, [state]);

  const summary = connected ? (
    <>
      <p>
        Calls can be logged to HubSpot account {connected.accountRef}, as a note on the customer’s company record.{' '}
        <span className="muted">
          Token ending {connected.tokenHint}
          {connected.connectedBy ? `, connected by ${connected.connectedBy}` : ''}
          {connectedDate ? ` on ${connectedDate}` : ''}.
        </span>
      </p>
      {connected.lastError ? (
        <p role="alert">
          <span className="pill pill-off">Needs attention</span> {connected.lastError}{' '}
          {isOwner ? 'Paste a new token below.' : 'An owner can reconnect it here.'}
        </p>
      ) : null}
    </>
  ) : (
    <p className="muted">
      No CRM is connected, so calls are not logged anywhere outside Tesserafy.
      {isOwner ? '' : ' An owner can connect one here.'}
    </p>
  );

  if (!isOwner) return summary;
  if (!available) {
    return (
      <>
        {summary}
        <p className="muted" style={{ marginBottom: 0 }}>
          Connecting a CRM is not switched on for this deployment yet.
        </p>
      </>
    );
  }

  const showForm = !connected || replacing || Boolean(connected.lastError);

  return (
    <>
      {summary}
      {state.status === 'connected' ? <p role="status">Connected to {state.account}.</p> : null}

      {showForm ? (
        <form action={connect}>
          <div className="field">
            <label htmlFor="crm-token">HubSpot private app access token</label>
            <input
              id="crm-token"
              name="token"
              type="password"
              required
              autoComplete="off"
              value={token}
              onChange={(event) => setToken(event.target.value)}
            />
          </div>
          <p className="muted">
            In HubSpot, create a private app (Settings → Integrations → Private apps) with the scopes
            crm.objects.companies.read, crm.objects.companies.write, crm.objects.contacts.read and
            crm.objects.contacts.write, and paste its access token. It is checked with HubSpot now, stored encrypted,
            and never shown again. A call is logged when someone presses Log on its page, to the company whose domain
            matches the call’s customer.
          </p>
          {state.status === 'error' ? <p role="alert">{state.message}</p> : null}
          <div className="toolbar">
            <button type="submit" disabled={connecting}>
              {connecting ? 'Checking with HubSpot…' : connected ? 'Replace' : 'Connect HubSpot'}
            </button>
            {replacing ? (
              <button type="button" onClick={() => setReplacing(false)} disabled={connecting}>
                Cancel
              </button>
            ) : null}
          </div>
        </form>
      ) : (
        <div className="toolbar">
          <button type="button" onClick={() => setReplacing(true)}>
            Change token
          </button>
          {confirmDisconnect ? (
            <form action={disconnect} className="remove-confirm">
              <span>Disconnect? Calls already logged stay in HubSpot; no more can be logged.</span>
              <button type="submit" disabled={disconnecting}>
                {disconnecting ? 'Disconnecting…' : 'Yes, disconnect'}
              </button>
              <button type="button" onClick={() => setConfirmDisconnect(false)} disabled={disconnecting}>
                Cancel
              </button>
            </form>
          ) : (
            <button type="button" onClick={() => setConfirmDisconnect(true)}>
              Disconnect
            </button>
          )}
        </div>
      )}
    </>
  );
}
