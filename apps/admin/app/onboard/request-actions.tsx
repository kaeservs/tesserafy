'use client';

import { useActionState, useState } from 'react';
import { addFromRequest, declineRequest, type DeclineState, type ProvisionState } from './actions';
import { LinkResult } from './link-result';

const ADD_START: ProvisionState = { status: 'idle' };
const DECLINE_START: DeclineState = { status: 'idle' };

export interface OpenRequest {
  id: string;
  companyName: string;
  companyId: string;
  email: string;
  role: string;
  note: string | null;
  requestedBy: string;
  asked: string;
}

/**
 * What owners have asked for, and the operator's answers.
 *
 * The actions and their results live here, in one component the page always
 * renders — not in each request's card. Answering a request refreshes the
 * page, the answered request drops out of the list, and a card that held the
 * one-time link would go with it before anyone could copy it. That happened
 * the first time this ran; this panel stays mounted, so the link stays.
 */
export function RequestsPanel({ requests }: { requests: OpenRequest[] }) {
  const [added, add, adding] = useActionState(addFromRequest, ADD_START);
  const [declined, decline, declining] = useActionState(declineRequest, DECLINE_START);
  // Declining asks for a reason first, so it is a second step, for one request.
  const [askingWhy, setAskingWhy] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const busy = adding || declining;

  return (
    <section aria-label="Asked for by owners">
      {added.status === 'ready' ? <LinkResult state={added} /> : null}
      {added.status === 'error' ? (
        <p className="tag open" role="alert" style={{ display: 'block', padding: '0.6rem' }}>
          {added.message}
        </p>
      ) : null}
      {declined.status === 'error' ? (
        <p className="tag open" role="alert" style={{ display: 'block', padding: '0.6rem' }}>
          {declined.message}
        </p>
      ) : null}

      {requests.length > 0 ? <h2>Asked for by owners ({requests.length})</h2> : null}
      {requests.map((request) => (
        <div className="card" key={request.id}>
          <p style={{ marginTop: 0 }}>
            <strong>{request.email}</strong> as {request.role} in <strong>{request.companyName}</strong>{' '}
            — asked by {request.requestedBy}, {request.asked}
          </p>
          {request.note ? <p className="muted">“{request.note}”</p> : null}
          <div className="row" style={{ alignItems: 'center' }}>
            <form action={add} className="go">
              <input type="hidden" name="requestId" value={request.id} />
              <input type="hidden" name="email" value={request.email} />
              <input type="hidden" name="role" value={request.role} />
              <input type="hidden" name="companyId" value={request.companyId} />
              <button type="submit" disabled={busy}>
                {adding ? 'Adding…' : `Add as ${request.role}`}
              </button>
            </form>
            {askingWhy === request.id ? (
              <form action={decline} className="row" style={{ flex: '1 1 20rem' }}>
                <input type="hidden" name="requestId" value={request.id} />
                <div>
                  <label htmlFor={`reason-${request.id}`}>Why, for the owner who asked</label>
                  <input
                    id={`reason-${request.id}`}
                    name="reason"
                    required
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                  />
                </div>
                <div className="go">
                  <button type="submit" disabled={busy}>
                    {declining ? 'Declining…' : 'Decline'}
                  </button>
                </div>
              </form>
            ) : (
              <div className="go">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setAskingWhy(request.id);
                    setReason('');
                  }}
                >
                  Decline…
                </button>
              </div>
            )}
          </div>
        </div>
      ))}
    </section>
  );
}
