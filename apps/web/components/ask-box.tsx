'use client';

import Link from 'next/link';
import { useState } from 'react';
import type { AskedPoint } from '@/lib/ask';
import { clock } from '@/lib/highlight';

const EXAMPLES = [
  'What do customers say slows their reporting down?',
  'Which calls mentioned a competitor, and what did they say about them?',
  'What timelines have customers given for a decision?',
];

interface Answer {
  points: AskedPoint[];
  note: string;
  dropped: number;
}

/**
 * The question box for "Ask your calls". The answer arrives as the agent
 * works (/api/ask streams one line per step), so the person sees what it is
 * searching for rather than a spinner, then the points, each with its quote
 * and a link to where it was said.
 */
export function AskBox({
  maxLength,
  accounts,
  periods,
  initialQuestion = '',
}: {
  maxLength: number;
  /** The company's accounts, to narrow a question to one's calls. */
  accounts: readonly { id: string; name: string }[];
  periods: readonly number[];
  /** A question carried from the home page's box; asked when the person presses Ask. */
  initialQuestion?: string;
}) {
  const [question, setQuestion] = useState(initialQuestion);
  const [accountId, setAccountId] = useState('');
  const [days, setDays] = useState('');
  const [busy, setBusy] = useState(false);
  const [steps, setSteps] = useState<string[]>([]);
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function ask(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || question.trim().length < 3) return;
    setBusy(true);
    setSteps([]);
    setAnswer(null);
    setError(null);
    try {
      const response = await fetch('/api/ask', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          question,
          ...(accountId ? { accountId } : {}),
          ...(days ? { days: Number(days) } : {}),
        }),
      });
      if (!response.ok || !response.body) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? 'That did not work. Try again in a moment.');
        return;
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffered = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffered += decoder.decode(value, { stream: true });
        const lines = buffered.split('\n');
        buffered = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.trim()) continue;
          const message = JSON.parse(line) as
            | { type: 'step'; text: string }
            | ({ type: 'answer' } & Answer)
            | { type: 'error'; error: string };
          if (message.type === 'step') setSteps((now) => [...now, message.text]);
          else if (message.type === 'answer') setAnswer({ points: message.points, note: message.note, dropped: message.dropped });
          else setError(message.error);
        }
      }
    } catch {
      setError('The connection dropped before the answer came. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <form className="card" onSubmit={(event) => void ask(event)}>
        <label htmlFor="ask-question">Your question</label>
        <textarea
          id="ask-question"
          name="question"
          rows={3}
          maxLength={maxLength}
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder="What do customers say about…"
          style={{ width: '100%' }}
        />
        <div className="toolbar" style={{ marginTop: '0.5rem' }}>
          <label>
            Calls with{' '}
            <select value={accountId} onChange={(event) => setAccountId(event.target.value)} disabled={busy}>
              <option value="">any account</option>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            From{' '}
            <select value={days} onChange={(event) => setDays(event.target.value)} disabled={busy}>
              <option value="">any time</option>
              {periods.map((period) => (
                <option key={period} value={period}>
                  the last {period} days
                </option>
              ))}
            </select>
          </label>
        </div>
        <p style={{ marginTop: '0.5rem' }}>
          <button type="submit" disabled={busy || question.trim().length < 3}>
            {busy ? 'Looking…' : 'Ask'}
          </button>
        </p>
        <p className="muted" style={{ marginBottom: 0 }}>Try:</p>
        <ul style={{ marginTop: '0.25rem' }}>
          {EXAMPLES.map((example) => (
            <li key={example}>
              <button type="button" className="link-button" disabled={busy} onClick={() => setQuestion(example)}>
                {example}
              </button>
            </li>
          ))}
        </ul>
      </form>

      {steps.length > 0 ? (
        <ol className="muted" aria-live="polite" aria-label="What it looked at">
          {steps.map((step, index) => (
            <li key={index}>{step}</li>
          ))}
        </ol>
      ) : null}

      {error ? (
        <p role="alert" className="card">
          {error}
        </p>
      ) : null}

      {answer ? (
        <section aria-labelledby="answer-heading" className="card">
          <h2 id="answer-heading" style={{ marginTop: 0 }}>
            Answer
          </h2>
          {answer.points.length === 0 && !answer.note ? <p>Nothing in your calls answers that.</p> : null}
          {answer.points.length > 0 ? (
            <ul className="ask-points">
              {answer.points.map((point, index) => (
                <li key={index}>
                  <p style={{ marginBottom: '0.25rem' }}>{point.text}</p>
                  <blockquote style={{ margin: '0 0 0.25rem 1rem' }}>“{point.quote}”</blockquote>
                  <p className="muted" style={{ marginTop: 0 }}>
                    {point.call && point.href ? (
                      <Link href={point.href}>
                        {point.call.speaker ?? 'Someone'}, {point.call.title}
                        {point.call.occurredAt ? `, ${new Date(point.call.occurredAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}` : ''}{' '}
                        at {clock(point.call.startMs)}
                      </Link>
                    ) : point.document ? (
                      <>From your document “{point.document}”</>
                    ) : null}
                  </p>
                </li>
              ))}
            </ul>
          ) : null}
          {answer.note ? <p className="muted">{answer.note}</p> : null}
          {answer.dropped > 0 ? (
            <p className="muted">
              {answer.dropped} point{answer.dropped === 1 ? ' was' : 's were'} left out because {answer.dropped === 1 ? 'its quote' : 'their quotes'} did not match what was said.
            </p>
          ) : null}
        </section>
      ) : null}
    </>
  );
}
