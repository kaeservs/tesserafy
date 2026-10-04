'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

/**
 * Log this call to the company's CRM (ADR 0024): a note on the customer's
 * record with the score, what it rests on, and the action items. Logging
 * again rewrites the same note, so it can follow the call as it changes.
 */
export function LogToCrm({
  conversationId,
  logged,
  hasCustomer,
}: {
  conversationId: string;
  logged: { when: string; companyName: string | null; by: string } | null;
  hasCustomer: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);

  async function log() {
    setBusy(true);
    setMessage(null);
    const response = await fetch(`/api/conversations/${conversationId}/crm`, { method: 'POST' });
    const result = (await response.json().catch(() => ({}))) as { companyName?: string; url?: string; updated?: boolean; error?: string };
    setBusy(false);
    if (!response.ok) {
      setMessage(result.error ?? 'That did not work.');
      return;
    }
    setMessage(`${result.updated ? 'Updated the note' : 'Logged'} on ${result.companyName ?? 'the company'} in HubSpot.`);
    setLink(result.url ?? null);
    router.refresh();
  }

  return (
    <>
      <p className="muted">
        A note on the customer’s company in HubSpot: the score, the words each met criterion rests on, the action items,
        and a link back here.
        {hasCustomer ? '' : ' Set this call’s customer, with its web domain, first.'}
      </p>
      <p className="toolbar">
        <button type="button" onClick={() => void log()} disabled={busy || !hasCustomer}>
          {busy ? 'Logging…' : logged ? 'Update the note in HubSpot' : 'Log to HubSpot'}
        </button>
        {logged ? (
          <span className="muted">
            <span className="pill pill-on">Logged</span> on {logged.companyName ?? 'the company'} · {logged.when} · {logged.by}
          </span>
        ) : null}
      </p>
      {message ? (
        <p role="status">
          {message}{' '}
          {link ? (
            <a href={link} target="_blank" rel="noreferrer">
              Open it in HubSpot
            </a>
          ) : null}
        </p>
      ) : null}
    </>
  );
}
