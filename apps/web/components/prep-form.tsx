'use client';

import { useRouter } from 'next/navigation';
import { useActionState, useEffect, useState } from 'react';
import { savePrep, type PrepState } from '@/app/(dashboard)/prep/actions';

const START: PrepState = { status: 'idle' };

export interface PrepFields {
  readonly prepId?: string;
  readonly name?: string;
  readonly title?: string | null;
  readonly linkedin?: string | null;
  readonly profile?: string | null;
  readonly accountId?: string | null;
  readonly engagementType?: string;
  /** ISO; shown in the browser's own time zone. */
  readonly callAt?: string | null;
}

/** An ISO time as a datetime-local value, in this browser's time zone. */
function localValue(iso: string | null | undefined): string {
  if (!iso) return '';
  const date = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * Who the call is with, their LinkedIn profile, and what it says. Saving writes
 * the prep; the brief is written straight after, and the prep opens with it.
 *
 * Every field is held in state, because React resets an uncontrolled form
 * after a server action and a pasted profile is a lot to paste twice.
 */
export function PrepForm({
  initial = {},
  accounts,
  scorecards,
}: {
  initial?: PrepFields;
  accounts: readonly { id: string; name: string }[];
  scorecards: readonly { value: string; label: string }[];
}) {
  const router = useRouter();
  const [fields, setFields] = useState({
    name: initial.name ?? '',
    title: initial.title ?? '',
    linkedin: initial.linkedin ?? '',
    profile: initial.profile ?? '',
    accountId: initial.accountId ?? '',
    newAccount: '',
    engagementType: initial.engagementType ?? scorecards[0]?.value ?? 'discovery',
    callAt: localValue(initial.callAt),
  });
  const [state, action, saving] = useActionState(savePrep, START);
  const [writing, setWriting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (key: keyof typeof fields) => (event: { target: { value: string } }) =>
    setFields((current) => ({ ...current, [key]: event.target.value }));

  useEffect(() => {
    if (state.status !== 'saved') return;
    const prepId = state.prepId;
    setWriting(true);
    setError(null);
    void (async () => {
      const response = await fetch(`/api/preps/${prepId}/brief`, { method: 'POST' });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        // Saved either way: the prep opens, and says its brief is still to write.
        setError(body.error ?? 'The brief could not be written.');
      }
      router.push(`/prep/${prepId}`);
      router.refresh();
    })();
  }, [state, router]);

  const busy = saving || writing;
  return (
    <form action={action}>
      {initial.prepId ? <input type="hidden" name="prepId" value={initial.prepId} /> : null}
      <input type="hidden" name="callAt" value={fields.callAt ? new Date(fields.callAt).toISOString() : ''} />
      <div className="field">
        <label htmlFor="prep-name">Who is the call with?</label>
        <input id="prep-name" name="name" required maxLength={120} value={fields.name} onChange={set('name')} placeholder="Tom Okafor" />
      </div>
      <div className="field">
        <label htmlFor="prep-title">Their role (optional)</label>
        <input id="prep-title" name="title" maxLength={200} value={fields.title} onChange={set('title')} placeholder="Head of Operations" />
      </div>
      <div className="field">
        <label htmlFor="prep-account">Their company</label>
        <select id="prep-account" name="accountId" value={fields.accountId} onChange={set('accountId')}>
          <option value="">A new customer, or none</option>
          {accounts.map((account) => (
            <option key={account.id} value={account.id}>
              {account.name}
            </option>
          ))}
        </select>
      </div>
      {fields.accountId === '' ? (
        <div className="field">
          <label htmlFor="prep-new-account">New customer’s name (optional)</label>
          <input id="prep-new-account" name="newAccount" maxLength={120} value={fields.newAccount} onChange={set('newAccount')} />
        </div>
      ) : null}
      <div className="field">
        <label htmlFor="prep-when">When</label>
        <input id="prep-when" type="datetime-local" value={fields.callAt} onChange={set('callAt')} />
      </div>
      {scorecards.length > 1 ? (
        <div className="field">
          <label htmlFor="prep-scorecard">Scorecard</label>
          <select id="prep-scorecard" name="engagementType" value={fields.engagementType} onChange={set('engagementType')}>
            {scorecards.map((scorecard) => (
              <option key={scorecard.value} value={scorecard.value}>
                {scorecard.label}
              </option>
            ))}
          </select>
        </div>
      ) : (
        <input type="hidden" name="engagementType" value={fields.engagementType} />
      )}
      <div className="field">
        <label htmlFor="prep-linkedin">Their LinkedIn profile (optional)</label>
        <input
          id="prep-linkedin"
          name="linkedin"
          type="url"
          inputMode="url"
          value={fields.linkedin}
          onChange={set('linkedin')}
          placeholder="https://www.linkedin.com/in/…"
        />
      </div>
      <div className="field">
        <label htmlFor="prep-profile">What their profile says (optional)</label>
        <textarea id="prep-profile" name="profile" rows={7} maxLength={12000} value={fields.profile} onChange={set('profile')} />
        <span className="muted" style={{ fontSize: '0.8rem' }}>
          Paste their About and Experience sections, or on their profile choose More, then Save to PDF, and paste the text.
          Tesserafy does not open LinkedIn itself: LinkedIn does not allow it. Everything the brief says about them quotes
          what you paste here, and email addresses and phone numbers in it are masked.
        </span>
      </div>
      <button type="submit" disabled={busy || fields.name.trim().length === 0}>
        {writing ? 'Writing the brief…' : saving ? 'Saving…' : initial.prepId ? 'Save and rewrite the brief' : 'Prepare'}
      </button>
      {state.status === 'error' ? <p role="alert">{state.message}</p> : null}
      {error ? <p role="alert">{error}</p> : null}
    </form>
  );
}
