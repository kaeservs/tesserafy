'use client';

import { useActionState, useEffect, useState } from 'react';
import {
  connectTracker,
  disconnectTracker,
  type TrackerState,
} from '@/app/(dashboard)/settings/tracker-actions';

const START: TrackerState = { status: 'idle' };

export interface ConnectedTracker {
  target: string;
  tokenHint: string;
  connectedBy: string | null;
  connectedAt: string;
}

/**
 * Where approved insights become tickets: the company's own GitHub repository.
 *
 * The token field is a password field held in state only until it is sent;
 * it is never shown again, only its last four characters. Replacing a token
 * is connecting again. Disconnecting takes two clicks, because it stops every
 * member from raising tickets until someone reconnects.
 */
export function TrackerPanel({
  connected,
  isOwner,
  available,
  connectedDate,
}: {
  connected: ConnectedTracker | null;
  isOwner: boolean;
  available: boolean;
  connectedDate: string | null;
}) {
  const [state, connect, connecting] = useActionState(connectTracker, START);
  const [, disconnect, disconnecting] = useActionState(disconnectTracker, START);
  const [repository, setRepository] = useState(connected?.target ?? '');
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
    <p>
      Approved insights become issues in{' '}
      <a href={`https://github.com/${connected.target}`} target="_blank" rel="noreferrer">
        github.com/{connected.target}
      </a>
      .{' '}
      <span className="muted">
        Token ending {connected.tokenHint}
        {connected.connectedBy ? `, connected by ${connected.connectedBy}` : ''}
        {connectedDate ? ` on ${connectedDate}` : ''}.
      </span>
    </p>
  ) : (
    <p className="muted">
      No tracker is connected, so approved insights cannot become tickets yet.
      {isOwner ? '' : ' An owner can connect one here.'}
    </p>
  );

  if (!isOwner) return summary;
  if (!available) {
    return (
      <>
        {summary}
        <p className="muted" style={{ marginBottom: 0 }}>
          Connecting a tracker is not switched on for this deployment yet.
        </p>
      </>
    );
  }

  const showForm = !connected || replacing;

  return (
    <>
      {summary}
      {state.status === 'connected' ? <p role="status">Connected to {state.target}.</p> : null}

      {showForm ? (
        <form action={connect}>
          <div className="field">
            <label htmlFor="tracker-repository">GitHub repository</label>
            <input
              id="tracker-repository"
              name="repository"
              required
              placeholder="acme/product or https://github.com/acme/product"
              value={repository}
              onChange={(event) => setRepository(event.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="tracker-token">Access token</label>
            <input
              id="tracker-token"
              name="token"
              type="password"
              required
              autoComplete="off"
              value={token}
              onChange={(event) => setToken(event.target.value)}
            />
          </div>
          <p className="muted">
            Create a fine-grained token in GitHub (Settings → Developer settings → Fine-grained
            tokens) with access to this one repository and one permission: Issues, read and write.
            It is checked with GitHub now, stored encrypted, and never shown again.
          </p>
          {state.status === 'error' ? <p role="alert">{state.message}</p> : null}
          <div className="toolbar">
            <button type="submit" disabled={connecting}>
              {connecting ? 'Checking with GitHub…' : connected ? 'Replace' : 'Connect'}
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
            Change repository or token
          </button>
          {confirmDisconnect ? (
            <form action={disconnect} className="remove-confirm">
              <span>Disconnect? Nobody can raise tickets until it is connected again.</span>
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
