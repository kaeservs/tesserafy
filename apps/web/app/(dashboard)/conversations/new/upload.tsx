'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

/**
 * The upload itself.
 *
 * A client component because the file has to be read and the result has to
 * navigate; everything around it is server-rendered as usual.
 *
 * It says what will happen after the upload rather than implying the work is
 * finished. A transcript lands with its segments and no embeddings or
 * signals, which is a real state and a visible one — the conversation reads
 * "captured" until somebody runs the pass. A page that said "done" and left a
 * meeting that could never reach an insight would be worse than one that
 * explains the next step.
 */
export function Upload({ sets }: { sets: { engagementType: string; version: number }[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setBusy(true);

    try {
      const response = await fetch('/api/transcripts', {
        method: 'POST',
        body: new FormData(event.currentTarget),
      });
      const body = (await response.json()) as {
        conversationId?: string;
        segments?: number;
        error?: string;
      };
      if (!response.ok || !body.conversationId) {
        throw new Error(body.error ?? `upload failed with ${response.status}`);
      }
      router.push(`/conversations/${body.conversationId}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'That upload did not work.');
      setBusy(false);
    }
  }

  return (
    // `void`, not because the rejection does not matter but because there is
    // none: submit catches its own and puts the message on the page. Handing
    // React a promise would mean nothing was listening if that ever changed.
    <form onSubmit={(event) => void submit(event)}>
      <div className="field">
        <label htmlFor="transcript">Transcript</label>
        <input
          id="transcript"
          name="transcript"
          type="file"
          accept=".vtt,.json"
          required
          disabled={busy}
        />
        <span className="muted" style={{ fontSize: '0.8rem' }}>
          WebVTT, or JSON turns. Parsed by the same code the importer uses.
        </span>
      </div>

      <div className="field">
        <label htmlFor="title">Title</label>
        <input
          id="title"
          name="title"
          type="text"
          placeholder="taken from the filename"
          disabled={busy}
        />
      </div>

      <div className="field">
        <label htmlFor="occurredAt">When it happened</label>
        <input id="occurredAt" name="occurredAt" type="date" disabled={busy} />
        {/* Not defaulted to today: a transcript is usually imported after the
            fact, and a wrong date silently decides when retention removes it. */}
        <span className="muted" style={{ fontSize: '0.8rem' }}>
          Optional, and worth setting — it decides where the call sorts and when
          retention reaches it.
        </span>
      </div>

      {sets.length > 1 && (
        <div className="field">
          <label htmlFor="engagementType">Score it as</label>
          <select id="engagementType" name="engagementType" disabled={busy}>
            {sets.map((set) => (
              <option key={`${set.engagementType}/${set.version}`} value={set.engagementType}>
                {set.engagementType} v{set.version}
              </option>
            ))}
          </select>
        </div>
      )}

      <button type="submit" disabled={busy}>
        {busy ? 'Reading…' : 'Import transcript'}
      </button>

      {error && <p role="alert">{error}</p>}
    </form>
  );
}
