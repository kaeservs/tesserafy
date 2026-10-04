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

export interface ShownSend {
  readonly recipients: readonly string[];
  readonly when: string;
  readonly byYou: boolean;
  readonly status: 'sending' | 'sent' | 'failed';
}

const NAME_KEY = 'tesserafy.followUpName';

function rememberedName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? '';
  } catch {
    return '';
  }
}

/**
 * The call's follow-up email: drafted when asked (one read of the call,
 * charged like its action items), editable before it is copied, opened in
 * the seller's email app or sent from here (ADR 0023), and shown with what
 * each line rests on — the quote and the moment — because it goes out in the
 * seller's name.
 */
export function FollowUp({
  conversationId,
  draft,
  sending = null,
  sends = [],
}: {
  conversationId: string;
  draft: ShownFollowUp | null;
  /** Where email is sent from, when this deployment sends it; null when it does not. */
  sending?: { from: string } | null;
  sends?: readonly ShownSend[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [subject, setSubject] = useState(draft?.subject ?? '');
  const [body, setBody] = useState(draft?.text ?? '');
  const [copied, setCopied] = useState(false);
  const [to, setTo] = useState(sends[0]?.recipients.join(', ') ?? '');
  const [fromName, setFromName] = useState('');
  const [sendingNow, setSendingNow] = useState(false);

  // The name is remembered in this browser only: a convenience, not a record.
  useEffect(() => setFromName(rememberedName()), []);

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

  async function send() {
    setSendingNow(true);
    setMessage(null);
    try {
      localStorage.setItem(NAME_KEY, fromName.trim());
    } catch {
      // Not remembered; asked again next time.
    }
    const response = await fetch(`/api/conversations/${conversationId}/follow-up/send`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ to, fromName, subject, body }),
    });
    const result = (await response.json().catch(() => ({}))) as { sent?: string[]; copied?: string; error?: string };
    setSendingNow(false);
    if (!response.ok) {
      setMessage(result.error ?? 'That did not send.');
    } else {
      setMessage(`Sent to ${(result.sent ?? []).join(', ')}. A copy went to ${result.copied ?? 'you'}.`);
    }
    router.refresh();
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
          {sending ? (
            <div className="follow-up-send">
              <label htmlFor="follow-up-to">To</label>
              <input
                id="follow-up-to"
                type="text"
                inputMode="email"
                autoComplete="off"
                value={to}
                onChange={(event) => setTo(event.target.value)}
                placeholder="dana@northwind.com, lee@northwind.com"
                style={{ width: '100%' }}
              />
              <label htmlFor="follow-up-name" style={{ marginTop: '0.75rem', display: 'block' }}>
                Your name
              </label>
              <input id="follow-up-name" value={fromName} onChange={(event) => setFromName(event.target.value)} autoComplete="name" />
              <p className="muted">
                From “{fromName.trim() || 'your name'}” &lt;{sending.from}&gt;. Replies come to you, and you are copied.
              </p>
              <p>
                <button type="button" onClick={() => void send()} disabled={sendingNow || !to.trim() || !fromName.trim() || !subject.trim() || !body.trim()}>
                  {sendingNow ? 'Sending…' : 'Send'}
                </button>
              </p>
            </div>
          ) : null}
          {sends.length > 0 ? (
            <ul className="follow-up-sent" aria-label="Sent from this call">
              {sends.map((sent, index) => (
                <li key={index}>
                  <span className={`pill ${sent.status === 'failed' ? 'pill-off' : 'pill-on'}`}>
                    {sent.status === 'sent' ? 'Sent' : sent.status === 'failed' ? 'Not sent' : 'Sending'}
                  </span>{' '}
                  to {sent.recipients.join(', ')} <span className="muted">· {sent.when} · {sent.byYou ? 'by you' : 'by a colleague'}</span>
                </li>
              ))}
            </ul>
          ) : null}
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
