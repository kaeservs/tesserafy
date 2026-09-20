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
}: {
  insightId: string;
  status: string;
  ticketUrl: string | null;
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

      {status === 'approved' && !raised && (
        <button type="button" onClick={() => void raise()} disabled={raising}>
          {raising ? 'Creating…' : 'Create ticket'}
        </button>
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
