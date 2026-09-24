'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

/**
 * "Find insights in this call."
 *
 * The only place a customer spends Opus, so it says what it does before it
 * does it, and it cannot be pressed twice: the button disables on the first
 * press, the route refuses a second run, and the database refuses a second set
 * of signals from the same detector. Three locks for one decision, because a
 * double click here is the most expensive double click in the product.
 */
export function ExtractButton({ conversationId }: { conversationId: string }) {
  const router = useRouter();
  const [state, setState] = useState<
    { kind: 'idle' } | { kind: 'running' } | { kind: 'done'; message: string } | { kind: 'error'; message: string }
  >({ kind: 'idle' });

  async function run() {
    setState({ kind: 'running' });
    try {
      const response = await fetch(`/api/conversations/${conversationId}/extract`, { method: 'POST' });
      const body = (await response.json()) as { recorded?: number; error?: string };
      if (!response.ok) {
        setState({ kind: 'error', message: body.error ?? 'That did not work.' });
        return;
      }
      const found = body.recorded ?? 0;
      setState({
        kind: 'done',
        message:
          found === 0
            ? 'Read the whole call. Nothing in it was a problem or a request this product could back with a quote.'
            : `Found ${found} signal${found === 1 ? '' : 's'}, each quoted from the transcript below.`,
      });
      router.refresh();
    } catch {
      setState({ kind: 'error', message: 'The request did not reach the server. Try again.' });
    }
  }

  if (state.kind === 'done') return <p style={{ margin: 0 }}>{state.message}</p>;

  return (
    <div>
      <button type="button" onClick={() => void run()} disabled={state.kind === 'running'}>
        {state.kind === 'running' ? 'Reading the call…' : 'Find insights in this call'}
      </button>
      {state.kind === 'running' ? (
        <p className="muted" style={{ marginBottom: 0 }}>
          The whole conversation is being read by a larger model. This can take up to a minute.
        </p>
      ) : null}
      {state.kind === 'error' ? (
        <p role="alert" style={{ marginBottom: 0 }}>
          {state.message}
        </p>
      ) : null}
    </div>
  );
}
