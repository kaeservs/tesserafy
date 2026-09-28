'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { decideInsight } from './actions';

/**
 * The approval control, and the one button that reaches outside this product.
 *
 * Creating a ticket is deliberately a second, separate click after approval.
 * One button that approved and raised at once would make an accidental click
 * visible in someone else's tracker, and nothing in this product should be
 * able to write into another system as a side effect of agreeing with it.
 */
export function Decide({
  insightId,
  status,
  ticketUrl,
  trackerTarget,
}: {
  insightId: string;
  status: string;
  ticketUrl: string | null;
  /** The company's GitHub repository, or null when none is connected. */
  trackerTarget: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [raising, setRaising] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [raised, setRaised] = useState<string | null>(ticketUrl);

  const decide = (next: 'approved' | 'dismissed') => {
    setError(null);
    startTransition(async () => {
      const result = await decideInsight(insightId, next);
      if (result.error) setError(result.error);
      else router.refresh();
    });
  };

  const raise = async () => {
    setError(null);
    setRaising(true);
    try {
      const response = await fetch(`/api/insights/${insightId}/ticket`, { method: 'POST' });
      const body = (await response.json()) as { url?: string; error?: string };
      if (!response.ok) throw new Error(body.error ?? `failed with ${response.status}`);
      setRaised(body.url ?? null);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'could not create the ticket');
    } finally {
      setRaising(false);
    }
  };

  return (
    <div className="toolbar">
      {status === 'proposed' && (
        <>
          <button type="button" onClick={() => decide('approved')} disabled={pending}>
            Approve
          </button>
          <button type="button" onClick={() => decide('dismissed')} disabled={pending}>
            Dismiss
          </button>
        </>
      )}

      {status === 'approved' && !raised && trackerTarget && (
        <button type="button" onClick={() => void raise()} disabled={raising}>
          {raising ? 'Creating…' : `Create ticket in ${trackerTarget}`}
        </button>
      )}

      {status === 'approved' && !raised && !trackerTarget && (
        <span className="muted">
          To turn this into a ticket, an owner connects your tracker under{' '}
          <a href="/settings#tracker-heading">Settings → Where tickets go</a>.
        </span>
      )}

      {status === 'dismissed' && <span className="muted">Dismissed</span>}

      {raised && (
        <span>
          Ticket:{' '}
          <a href={raised} target="_blank" rel="noreferrer">
            {raised.replace('https://github.com/', '')}
          </a>
        </span>
      )}

      {error && (
        <p role="alert">{error}</p>
      )}
    </div>
  );
}
