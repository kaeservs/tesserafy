'use client';

import { useActionState, useEffect, useState } from 'react';
import { sendFeedback, type FeedbackState } from '@/app/(dashboard)/feedback/actions';

const START: FeedbackState = { status: 'idle' };

/** The box itself. Held in state, so a refused send keeps what was typed. */
export function FeedbackForm({ page }: { page: string | null }) {
  const [body, setBody] = useState('');
  const [state, action, pending] = useActionState(sendFeedback, START);

  useEffect(() => {
    if (state.status === 'sent') setBody('');
  }, [state]);

  return (
    <form action={action}>
      {page ? <input type="hidden" name="page" value={page} /> : null}
      <div className="field">
        <label htmlFor="feedback-body">What should we know?</label>
        <textarea
          id="feedback-body"
          name="body"
          rows={6}
          maxLength={4000}
          required
          value={body}
          onChange={(event) => setBody(event.target.value)}
        />
        {page ? <span className="muted" style={{ fontSize: '0.8rem' }}>Sent from {page}, so we can see what you saw.</span> : null}
      </div>
      <button type="submit" disabled={pending || body.trim().length === 0}>
        Send to the Tesserafy team
      </button>
      {state.status === 'sent' ? <p role="status">Sent — thank you. It is below, and says when we have seen it.</p> : null}
      {state.status === 'error' ? <p role="alert">{state.message}</p> : null}
    </form>
  );
}
