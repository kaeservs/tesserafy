'use client';

import { useRouter } from 'next/navigation';
import { useActionState, useEffect, useState } from 'react';
import { FEEDBACK_START, REASON_MAX, REASON_MIN, type FeedbackState } from '@/lib/feedback';

/**
 * "Not right", on anything the AI wrote other than a score (a score has its
 * own "This score is wrong"). It removes the result and asks why: the reason
 * is what the AI is shown from then on, so it is required. Owners see every
 * one on AI guidance and can switch it off.
 */
export function NotRight({
  action,
  fields,
  about,
  placeholder,
}: {
  action: (state: FeedbackState, formData: FormData) => Promise<FeedbackState>;
  /** Hidden inputs naming what this is about. */
  fields: Readonly<Record<string, string>>;
  /** What it is, for a screen reader: "the action item “Send pricing”". */
  about: string;
  placeholder: string;
}) {
  const [state, send, pending] = useActionState(action, FEEDBACK_START);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const router = useRouter();

  // The page it sits on is refreshed from here once the action is done, so
  // one control serves a call and a prep alike.
  useEffect(() => {
    if (state.status === 'saved') router.refresh();
  }, [state, router]);

  if (state.status === 'saved') {
    return (
      <span role="status" className="muted not-right">
        Removed. The AI learns from it.
      </span>
    );
  }

  if (!open) {
    return (
      <button type="button" className="link-button not-right" aria-label={`Not right: ${about}`} onClick={() => setOpen(true)}>
        Not right
      </button>
    );
  }
  return (
    <form action={send} className="not-right-form">
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <label>
        <span className="muted">Why? The AI learns from it for everything it reads from now on.</span>
        <input
          name="reason"
          value={reason}
          required
          minLength={REASON_MIN}
          maxLength={REASON_MAX}
          placeholder={placeholder}
          aria-label={`Why ${about} is not right`}
          onChange={(event) => setReason(event.target.value)}
        />
      </label>
      <span className="toolbar">
        <button type="submit" disabled={pending || reason.trim().length < REASON_MIN}>
          {pending ? 'Removing…' : 'Remove and teach'}
        </button>
        <button type="button" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </span>
      {state.status === 'error' ? <span role="alert">{state.message}</span> : null}
    </form>
  );
}
