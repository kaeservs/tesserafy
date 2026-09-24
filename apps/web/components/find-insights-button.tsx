'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

/**
 * "Look for patterns across your calls."
 *
 * Says what it will do before it does it, because it spends a larger model and
 * produces claims — even though every one of them arrives as a proposal for a
 * person to approve, not as a published finding.
 */
export function FindInsightsButton() {
  const router = useRouter();
  const [state, setState] = useState<
    { kind: 'idle' } | { kind: 'running' } | { kind: 'done'; message: string } | { kind: 'error'; message: string }
  >({ kind: 'idle' });

  async function run() {
    setState({ kind: 'running' });
    try {
      const response = await fetch('/api/insights/find', { method: 'POST' });
      const body = (await response.json()) as {
        signals?: number;
        groups?: number;
        proposed?: number;
        declined?: number;
        remaining?: number;
        alreadyDeclined?: number;
        error?: string;
      };
      if (!response.ok) {
        setState({ kind: 'error', message: body.error ?? 'That did not work.' });
        return;
      }
      const proposed = body.proposed ?? 0;
      const parts = [
        body.groups === 0
          ? `Looked across ${body.signals ?? 0} signals and found nothing said in more than one call yet.`
          : `Proposed ${proposed} insight${proposed === 1 ? '' : 's'} for you to review below.`,
      ];
      if ((body.declined ?? 0) > 0) {
        parts.push(`${body.declined} group${body.declined === 1 ? ' was' : 's were'} set aside as similar wording rather than one finding.`);
      }
      if ((body.alreadyDeclined ?? 0) > 0) {
        parts.push(`${body.alreadyDeclined} group${body.alreadyDeclined === 1 ? '' : 's'} set aside before ${body.alreadyDeclined === 1 ? 'was' : 'were'} not looked at again.`);
      }
      if ((body.remaining ?? 0) > 0) {
        parts.push(`${body.remaining} more are waiting; press again to write them up.`);
      }
      setState({ kind: 'done', message: parts.join(' ') });
      router.refresh();
    } catch {
      setState({ kind: 'error', message: 'The request did not reach the server. Try again.' });
    }
  }

  return (
    <section className="card" aria-labelledby="find-heading">
      <h2 id="find-heading" style={{ marginTop: 0 }}>
        Look for patterns across your calls
      </h2>
      <p className="muted">
        Groups what customers said that comes up in more than one call, and writes each group up
        as an insight — every one quoted from the transcripts and proposed for you to approve, not
        published. Calls are only included once they have been read for insights.
      </p>
      {state.kind === 'done' ? (
        <p style={{ margin: 0 }}>{state.message}</p>
      ) : (
        <button type="button" onClick={() => void run()} disabled={state.kind === 'running'}>
          {state.kind === 'running' ? 'Looking across your calls…' : 'Look for patterns'}
        </button>
      )}
      {state.kind === 'running' ? (
        <p className="muted" style={{ marginBottom: 0 }}>
          This can take a minute or two.
        </p>
      ) : null}
      {state.kind === 'error' ? (
        <p role="alert" style={{ marginBottom: 0 }}>
          {state.message}
        </p>
      ) : null}
    </section>
  );
}
