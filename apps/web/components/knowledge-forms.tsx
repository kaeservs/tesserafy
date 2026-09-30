'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

/**
 * Adding to the company's knowledge: a file, or pasted text. Sent to
 * /api/knowledge, which reads, splits and embeds it before answering — a few
 * seconds for a page, longer for a long PDF — so the button says so.
 */
export function AddKnowledge({ accept }: { accept: string }) {
  const router = useRouter();
  const [mode, setMode] = useState<'file' | 'text'>('file');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    const form = new FormData(event.currentTarget);
    const response = await fetch('/api/knowledge', { method: 'POST', body: form });
    const body = (await response.json().catch(() => ({}))) as { error?: string; passages?: number; truncated?: boolean };
    setBusy(false);
    if (!response.ok) {
      setMessage(body.error ?? 'That did not work.');
    } else {
      setMessage(
        `Added: ${body.passages} passage${body.passages === 1 ? '' : 's'}.${body.truncated ? ' It was long, so only the first 250,000 characters were kept.' : ''}`,
      );
      event.currentTarget?.reset();
    }
    router.refresh();
  }

  return (
    <form className="card knowledge-add" onSubmit={(event) => void submit(event)}>
      <h2 style={{ marginTop: 0 }}>Add a document</h2>
      <div className="toolbar" role="radiogroup" aria-label="What to add">
        <label>
          <input type="radio" name="kind" checked={mode === 'file'} onChange={() => setMode('file')} /> A file
        </label>
        <label>
          <input type="radio" name="kind" checked={mode === 'text'} onChange={() => setMode('text')} /> Paste text
        </label>
      </div>
      <div className="field">
        <label htmlFor="knowledge-title">Title{mode === 'file' ? ' (optional: the file name otherwise)' : ''}</label>
        <input id="knowledge-title" name="title" maxLength={200} required={mode === 'text'} placeholder="Pricing and plans" />
      </div>
      {mode === 'file' ? (
        <div className="field">
          <label htmlFor="knowledge-file">File — PDF, Word, text or Markdown, up to 4 MB</label>
          <input id="knowledge-file" name="file" type="file" accept={accept} required />
        </div>
      ) : (
        <div className="field">
          <label htmlFor="knowledge-text">Text</label>
          <textarea id="knowledge-text" name="text" rows={8} minLength={20} required placeholder="Pro is $20 a seat a month, billed yearly…" />
        </div>
      )}
      <button type="submit" disabled={busy}>
        {busy ? 'Reading it…' : 'Add to knowledge'}
      </button>
      {message ? (
        <p role="status" className="muted">
          {message}
        </p>
      ) : null}
    </form>
  );
}
