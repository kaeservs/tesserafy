'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

/**
 * "Try it with a sample call": imports Tesserafy's invented discovery call,
 * scores it, and opens it. Offered until a company has had its one sample.
 */
export function SampleCallButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/sample-call', { method: 'POST' });
      const body = (await response.json()) as { conversationId?: string; error?: string };
      if (!response.ok || !body.conversationId) {
        setError(body.error ?? 'The sample call could not be imported.');
        setBusy(false);
        return;
      }
      router.push(`/conversations/${body.conversationId}`);
    } catch {
      setError('The sample call could not be imported.');
      setBusy(false);
    }
  }

  return (
    <div className="sample-call">
      <button type="button" onClick={() => void run()} disabled={busy}>
        {busy ? 'Importing and scoring the sample…' : 'Try it with a sample call'}
      </button>
      <span className="muted" style={{ fontSize: '0.82rem' }}>
        {busy
          ? ' Usually under a minute.'
          : ' An invented discovery call, scored the way yours will be. It does not use one of your plan’s calls, and you can delete it whenever you like.'}
      </span>
      {error ? <p role="alert">{error}</p> : null}
    </div>
  );
}
