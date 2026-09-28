'use client';

import { TRANSCRIPT_EXTENSIONS } from '@tesserafy/ingest';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { engagementLabel } from '@/lib/company';
import { CONSENT_STATEMENTS } from '@/lib/consent';

/**
 * The upload itself: one transcript, or a folder of them.
 *
 * One file behaves as it always did — imported, then you are taken to it,
 * scoring after the response. Several are imported one after another, each
 * waiting for its own score before the next is sent (`wait=1`), so a folder
 * of forty old calls becomes forty steady passes rather than forty at once.
 * Each file is its own import: charged to the plan on its own, failing on its
 * own, and a plan that runs out stops the queue there and says so, rather
 * than refusing the rest one by one.
 *
 * It says what will happen after the upload rather than implying the work is
 * finished: scoring is shown per file; reading a call for insights is still a
 * separate pass somebody asks for.
 */

type FileStatus =
  | { state: 'waiting' }
  | { state: 'working' }
  | { state: 'done'; conversationId: string; scoring: string }
  | { state: 'failed'; message: string }
  | { state: 'skipped'; message: string };

const SCORING: Record<string, string> = {
  scored: 'scored',
  nothing_to_score: 'nothing to score',
  too_long: 'too long to score automatically',
  failed: 'imported, but scoring failed — it can be scored again from the call',
};

export function Upload({
  sets,
  accounts,
}: {
  sets: { engagementType: string; version: number; own: boolean }[];
  accounts: string[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [count, setCount] = useState(0);
  const [queue, setQueue] = useState<{ name: string; status: FileStatus }[]>([]);
  const many = count > 1;

  function mark(index: number, status: FileStatus) {
    setQueue((current) => current.map((item, i) => (i === index ? { ...item, status } : item)));
  }

  async function submitOne(data: FormData) {
    const response = await fetch('/api/transcripts', { method: 'POST', body: data });
    const body = (await response.json()) as { conversationId?: string; error?: string };
    if (!response.ok || !body.conversationId) throw new Error(body.error ?? `upload failed with ${response.status}`);
    router.push(`/conversations/${body.conversationId}`);
  }

  async function submitMany(files: File[], shared: FormData) {
    setQueue(files.map((file) => ({ name: file.name, status: { state: 'waiting' } })));
    for (const [index, file] of files.entries()) {
      mark(index, { state: 'working' });
      const data = new FormData();
      for (const [key, value] of shared.entries()) {
        if (key !== 'transcript' && key !== 'title' && key !== 'occurredAt') data.append(key, value);
      }
      data.set('transcript', file);
      data.set('wait', '1');
      try {
        const response = await fetch('/api/transcripts', { method: 'POST', body: data });
        const body = (await response.json().catch(() => ({}))) as { conversationId?: string; scoring?: string; error?: string };
        if (response.ok && body.conversationId) {
          mark(index, { state: 'done', conversationId: body.conversationId, scoring: body.scoring ?? 'scored' });
          continue;
        }
        // The plan or the rate limit: nothing after this would get through.
        if (response.status === 402 || response.status === 429) {
          mark(index, { state: 'failed', message: body.error ?? 'Stopped.' });
          setQueue((current) =>
            current.map((item, i) => (i > index ? { ...item, status: { state: 'skipped', message: 'not imported' } } : item)),
          );
          return;
        }
        mark(index, { state: 'failed', message: body.error ?? `failed with ${response.status}` });
      } catch {
        mark(index, { state: 'failed', message: 'Could not reach Tesserafy.' });
      }
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    const data = new FormData(event.currentTarget);
    const files = data.getAll('transcript').filter((value): value is File => value instanceof File && value.size > 0);
    try {
      if (files.length <= 1) {
        await submitOne(data);
        return;
      }
      await submitMany(files, data);
      setBusy(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'That upload did not work.');
      setBusy(false);
    }
  }

  const done = queue.filter((item) => item.status.state === 'done').length;

  return (
    // `void`, not because the rejection does not matter but because there is
    // none: submit catches its own and puts the message on the page. Handing
    // React a promise would mean nothing was listening if that ever changed.
    <form onSubmit={(event) => void submit(event)}>
      <div className="field">
        <label htmlFor="transcript">Transcripts</label>
        <input
          id="transcript"
          name="transcript"
          type="file"
          accept={TRANSCRIPT_EXTENSIONS.join(',')}
          multiple
          required
          disabled={busy}
          onChange={(event) => {
            setCount(event.target.files?.length ?? 0);
            setQueue([]);
          }}
        />
        <span className="muted" style={{ fontSize: '0.8rem' }}>
          WebVTT (.vtt) from Zoom, Meet or Teams, SubRip (.srt), or a text transcript (.txt) from Otter, Fireflies or a Meet document — with its timestamps. Choose several to import them together.
        </span>
      </div>

      {many ? (
        <p className="muted">
          {count} files. Each becomes its own call, titled from the file, and counts as one imported call on your
          plan. They are imported one after another and scored as they go — keep this page open until the list
          finishes.
        </p>
      ) : (
        <>
          <div className="field">
            <label htmlFor="title">Title</label>
            <input id="title" name="title" type="text" placeholder="taken from the filename" disabled={busy} />
          </div>

          <div className="field">
            <label htmlFor="occurredAt">When it happened</label>
            <input id="occurredAt" name="occurredAt" type="date" disabled={busy} />
            {/* Not defaulted to today: a transcript is usually imported after the
                fact, and a wrong date silently decides when retention removes it. */}
            <span className="muted" style={{ fontSize: '0.8rem' }}>
              Optional, and worth setting — it decides where the call sorts and when retention reaches it.
            </span>
          </div>
        </>
      )}

      {sets.length > 1 && (
        <div className="field">
          <label htmlFor="engagementType">Score {many ? 'them' : 'it'} as</label>
          {/* Name and version together: the newest version of each, sent as
              the pair, so a call is pinned to the version it was shown. */}
          <select id="engagementType" name="criteriaSet" disabled={busy}>
            {sets.map((set) => (
              <option key={`${set.engagementType}/${set.version}`} value={`${set.engagementType}/${set.version}`}>
                {engagementLabel(set.engagementType)}
                {set.own ? '' : ' (template)'}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="field">
        <label htmlFor="account">Who {many ? 'they were' : 'the call was'} with (optional)</label>
        <input id="account" name="account" list="account-names" maxLength={120} placeholder="Acme Robotics" disabled={busy} />
        <datalist id="account-names">
          {accounts.map((name) => (
            <option key={name} value={name} />
          ))}
        </datalist>
      </div>

      {/* Required, and the words are the ones stored with the call. */}
      <div className="field consent">
        <label>
          <input type="checkbox" name="consent" required disabled={busy} /> {CONSENT_STATEMENTS.imported}
          {many ? ' (For every call in these files.)' : ''}
        </label>
      </div>

      <button type="submit" disabled={busy}>
        {busy ? (many ? `Importing… ${done} of ${count}` : 'Reading…') : many ? `Import ${count} transcripts` : 'Import transcript'}
      </button>

      {error && <p role="alert">{error}</p>}

      {queue.length > 0 ? (
        <table className="team" style={{ marginTop: '1rem' }} aria-live="polite">
          <thead>
            <tr>
              <th scope="col">File</th>
              <th scope="col">Where it got to</th>
            </tr>
          </thead>
          <tbody>
            {queue.map((item, index) => (
              <tr key={`${item.name}-${index}`}>
                <td>{item.name}</td>
                <td>
                  {item.status.state === 'waiting' ? <span className="muted">waiting</span> : null}
                  {item.status.state === 'working' ? 'importing and scoring…' : null}
                  {item.status.state === 'done' ? (
                    <>
                      <Link href={`/conversations/${item.status.conversationId}`}>imported</Link>
                      <span className="muted"> · {SCORING[item.status.scoring] ?? item.status.scoring}</span>
                    </>
                  ) : null}
                  {item.status.state === 'failed' ? <span role="alert">{item.status.message}</span> : null}
                  {item.status.state === 'skipped' ? <span className="muted">{item.status.message}</span> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      {!busy && queue.length > 0 && done > 0 ? (
        <p>
          <Link href="/conversations">See them in Meetings →</Link>
        </p>
      ) : null}
    </form>
  );
}
