'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

export interface ShownFollowUp {
  readonly subject: string;
  /** The email as plain text, assembled on the server (followUpText). */
  readonly text: string;
  readonly drafted: string;
  readonly lines: readonly {
    readonly kind: 'recap' | 'next_step';
    readonly text: string;
    readonly segmentId: string;
    readonly quote: string;
    readonly at: string;
  }[];
}

/**
 * The call's follow-up email: drafted when asked (one read of the call,
 * charged like its action items), editable before it is copied or opened in
 * the seller's email app, and shown with what each line rests on — the quote
 * and the moment — because it goes out in the seller's name.
 */
export function FollowUp({ conversationId, draft }: { conversationId: string; draft: ShownFollowUp | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [subject, setSubject] = useState(draft?.subject ?? '');
  const [body, setBody] = useState(draft?.text ?? '');
  const [copied, setCopied] = useState(false);

  // A new draft replaces what was being edited.
  useEffect(() => {
    setSubject(draft?.subject ?? '');
    setBody(draft?.text ?? '');
  }, [draft?.subject, draft?.text]);

  async function draftIt() {
    setBusy(true);
    setMessage(null);
    const response = await fetch(`/api/conversations/${conversationId}/follow-up`, { method: 'POST' });
    const result = (await response.json().catch(() => ({}))) as { lines?: number; dropped?: number; error?: string };
    if (!response.ok) setMessage(result.error ?? 'That did not work.');
    else if (result.dropped) {
      setMessage(`${result.dropped} line${result.dropped === 1 ? ' was' : 's were'} left out because ${result.dropped === 1 ? 'its quote' : 'their quotes'} did not match what was said.`);
    }
    setBusy(false);
    router.refresh();
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(`Subject: ${subject}\n\n${body}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2_000);
    } catch {
      setMessage('Copying was not allowed here; select the text instead.');
    }
  }

  const mailto = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

  return (
    <>
      <p className="muted">
        An email to the customer from this call: what they said, and the next steps agreed. Every line quotes the call,
        and it promises nothing the call did not. Read it before you send it: it goes out in your name.
      </p>
      <p>
        <button type="button" onClick={() => void draftIt()} disabled={busy}>
          {busy ? 'Drafting…' : draft ? 'Draft it again' : 'Draft the follow-up email'}
        </button>
      </p>
      {message ? <p role="status">{message}</p> : null}
      {draft ? (
        <div className="card">
          <label htmlFor="follow-up-subject">Subject</label>
          <input id="follow-up-subject" value={subject} onChange={(event) => setSubject(event.target.value)} style={{ width: '100%' }} />
          <label htmlFor="follow-up-body" style={{ marginTop: '0.75rem', display: 'block' }}>
            Email
          </label>
          <textarea id="follow-up-body" rows={14} value={body} onChange={(event) => setBody(event.target.value)} style={{ width: '100%' }} />
          <p className="toolbar">
            <button type="button" onClick={() => void copy()}>
              {copied ? 'Copied' : 'Copy'}
            </button>
            <a href={mailto}>Open in your email app</a>
            <span className="muted">Drafted {draft.drafted}</span>
          </p>
          {draft.lines.length > 0 ? (
            <details>
              <summary>What each line rests on</summary>
              <ul>
                {draft.lines.map((line, index) => (
                  <li key={index}>
                    {line.text}{' '}
                    <a href={`#segment-${line.segmentId}`}>
                      “{line.quote}” <span className="muted">at {line.at}</span>
                    </a>
                  </li>
                ))}
              </ul>
            </details>
          ) : (
            <p className="muted">Nothing in the call could be quoted for a recap or a next step.</p>
          )}
        </div>
      ) : null}
    </>
  );
}
