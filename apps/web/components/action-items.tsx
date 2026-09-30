'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toggleActionItem } from '@/app/(dashboard)/conversations/[id]/action-actions';

const SIDE: Record<string, string> = { ours: 'Ours', theirs: 'Theirs', both: 'Both', unclear: 'Not said' };

export interface ShownActionItem {
  readonly id: string;
  readonly action: string;
  readonly ownerSide: string;
  readonly ownerName: string | null;
  readonly due: string | null;
  readonly done: boolean;
  readonly segmentId: string;
  readonly quote: string;
  readonly at: string;
}

/**
 * A call's action items: each one quoted, with whose it is and when it is
 * due as said, and a box to tick it done. Finding them is one read of the
 * call, charged like Find insights; finding them again keeps what was done.
 */
export function ActionItems({ conversationId, items }: { conversationId: string; items: readonly ShownActionItem[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function find() {
    setBusy(true);
    setMessage(null);
    const response = await fetch(`/api/conversations/${conversationId}/actions`, { method: 'POST' });
    const body = (await response.json().catch(() => ({}))) as { recorded?: number; error?: string };
    setMessage(response.ok ? (body.recorded ? null : 'No commitments or next steps in this call.') : (body.error ?? 'That did not work.'));
    setBusy(false);
    router.refresh();
  }

  return (
    <>
      {items.length > 0 ? (
        <ul className="action-items">
          {items.map((item) => (
            <li key={item.id} className={item.done ? 'done' : undefined}>
              <form action={toggleActionItem} className="inline-form">
                <input type="hidden" name="itemId" value={item.id} />
                <input type="hidden" name="conversationId" value={conversationId} />
                <input type="hidden" name="done" value={item.done ? 'no' : 'yes'} />
                <button type="submit" className="action-check" aria-label={item.done ? `Mark “${item.action}” not done` : `Mark “${item.action}” done`}>
                  {item.done ? '☑' : '☐'}
                </button>
              </form>
              <div>
                <div className="action-text">{item.action}</div>
                <div className="muted action-meta">
                  <span className={`stage side-${item.ownerSide}`}>{SIDE[item.ownerSide] ?? item.ownerSide}</span>
                  {item.ownerName ? ` ${item.ownerName}` : ''}
                  {item.due ? ` · due ${item.due}` : ''} ·{' '}
                  <a href={`#segment-${item.segmentId}`}>
                    “{item.quote}” <span className="muted">at {item.at}</span>
                  </a>
                </div>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
      <p>
        <button type="button" onClick={() => void find()} disabled={busy}>
          {busy ? 'Reading the call…' : items.length > 0 ? 'Find them again' : 'Find action items'}
        </button>
        {message ? <span role="status" className="muted"> {message}</span> : null}
      </p>
    </>
  );
}
