'use client';

import { useActionState, useEffect, useMemo, useState } from 'react';
import {
  disputeScore,
  withdrawDispute,
  type DisputeState,
} from '@/app/(dashboard)/conversations/[id]/call-actions';

const START: DisputeState = { status: 'idle' };

export interface DisputableCriterion {
  readonly key: string;
  readonly label: string;
  readonly status: string;
  /** The words the scorecard rests on for it: what "it wasn't met" disputes. */
  readonly claims: readonly { segmentId: string; quote: string }[];
}

export interface DisputeMoment {
  readonly id: string;
  readonly at: string;
  readonly speaker: string;
  readonly text: string;
}

export interface Correction {
  readonly id: string;
  readonly label: string;
  readonly kind: 'evidence' | 'contradiction';
  readonly quote: string;
  readonly segmentId: string;
  readonly reason: string;
  readonly by: string;
  readonly mayWithdraw: boolean;
}

function Withdraw({ conversationId, eventId }: { conversationId: string; eventId: string }) {
  const [state, withdraw, pending] = useActionState(withdrawDispute, START);
  return (
    <form action={withdraw} className="inline-form">
      <input type="hidden" name="conversationId" value={conversationId} />
      <input type="hidden" name="eventId" value={eventId} />
      <button type="submit" className="link-button" disabled={pending}>
        Withdraw
      </button>
      {state.status === 'error' ? <span role="alert"> {state.message}</span> : null}
    </form>
  );
}

/** The corrections on a call, each with who made it and why. */
export function Corrections({ conversationId, corrections }: { conversationId: string; corrections: readonly Correction[] }) {
  if (corrections.length === 0) return null;
  return (
    <div className="corrections">
      <h3>Corrections</h3>
      <ul className="evidence">
        {corrections.map((correction) => (
          <li key={correction.id}>
            <strong>{correction.label}</strong> {correction.kind === 'evidence' ? 'was met' : 'was not met'}:{' '}
            <a href={`#segment-${correction.segmentId}`}>“{correction.quote}”</a>{' '}
            <span className="muted">
              — {correction.by}: {correction.reason}
            </span>{' '}
            {correction.mayWithdraw ? <Withdraw conversationId={conversationId} eventId={correction.id} /> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * "This score is wrong." A correction has to point at words, like everything
 * else on this page: "it was met" names the moment and quotes it; "it wasn't
 * met" names which of the scorecard's quotes is wrong. The engine does the
 * rest, so the number stays one nobody typed.
 */
export function DisputeScore({
  conversationId,
  criteria,
  moments,
}: {
  conversationId: string;
  criteria: readonly DisputableCriterion[];
  moments: readonly DisputeMoment[];
}) {
  const [state, dispute, pending] = useActionState(disputeScore, START);
  const [open, setOpen] = useState(false);
  const [criterionKey, setCriterionKey] = useState(criteria[0]?.key ?? '');
  const criterion = criteria.find((item) => item.key === criterionKey);
  const canUnmeet = (criterion?.claims.length ?? 0) > 0;
  const [kind, setKind] = useState<'evidence' | 'contradiction'>('evidence');
  const [claim, setClaim] = useState(0);
  const [momentId, setMomentId] = useState(moments[0]?.id ?? '');
  const moment = useMemo(() => moments.find((item) => item.id === momentId), [moments, momentId]);
  const [quote, setQuote] = useState(moment?.text ?? '');
  const [reason, setReason] = useState('');

  useEffect(() => {
    if (state.status !== 'saved') return;
    setReason('');
    setOpen(false);
  }, [state]);

  if (criteria.length === 0 || moments.length === 0) return null;
  const chosenClaim = criterion?.claims[claim];
  const segmentId = kind === 'contradiction' ? (chosenClaim?.segmentId ?? '') : momentId;
  const sentQuote = kind === 'contradiction' ? (chosenClaim?.quote ?? '') : quote;

  if (!open) {
    return (
      <p>
        <button type="button" className="link-button" onClick={() => setOpen(true)}>
          This score is wrong
        </button>
        {state.status === 'saved' ? <span role="status" className="muted"> Recorded; the score above includes it.</span> : null}
      </p>
    );
  }

  return (
    <form action={dispute} className="card dispute">
      <input type="hidden" name="conversationId" value={conversationId} />
      <input type="hidden" name="segmentId" value={segmentId} />
      <input type="hidden" name="quote" value={sentQuote} />
      <div className="field">
        <label htmlFor="dispute-criterion">Which criterion</label>
        <select
          id="dispute-criterion"
          name="criterion"
          value={criterionKey}
          onChange={(event) => {
            setCriterionKey(event.target.value);
            setClaim(0);
            const next = criteria.find((item) => item.key === event.target.value);
            if (!next?.claims.length) setKind('evidence');
          }}
        >
          {criteria.map((item) => (
            <option key={item.key} value={item.key}>
              {item.label} — {item.status}
            </option>
          ))}
        </select>
      </div>
      <fieldset className="field">
        <legend>What is wrong</legend>
        <label>
          <input type="radio" name="kind" value="evidence" checked={kind === 'evidence'} onChange={() => setKind('evidence')} /> It
          was met, and the scorecard missed it
        </label>
        <label>
          <input
            type="radio"
            name="kind"
            value="contradiction"
            checked={kind === 'contradiction'}
            disabled={!canUnmeet}
            onChange={() => setKind('contradiction')}
          />{' '}
          It was not met — the scorecard misread{canUnmeet ? '' : ' (nothing was claimed for it)'}
        </label>
      </fieldset>

      {kind === 'contradiction' && criterion ? (
        <div className="field">
          <label htmlFor="dispute-claim">The words it wrongly took as evidence</label>
          <select id="dispute-claim" value={claim} onChange={(event) => setClaim(Number(event.target.value))}>
            {criterion.claims.map((item, index) => (
              <option key={`${item.segmentId}-${index}`} value={index}>
                “{item.quote.length > 90 ? `${item.quote.slice(0, 90)}…` : item.quote}”
              </option>
            ))}
          </select>
        </div>
      ) : (
        <>
          <div className="field">
            <label htmlFor="dispute-moment">The moment it happened</label>
            <select
              id="dispute-moment"
              value={momentId}
              onChange={(event) => {
                setMomentId(event.target.value);
                setQuote(moments.find((item) => item.id === event.target.value)?.text ?? '');
              }}
            >
              {moments.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.at} · {item.speaker}: {item.text.length > 80 ? `${item.text.slice(0, 80)}…` : item.text}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="dispute-quote">The words that show it (trim to the part that matters)</label>
            <textarea id="dispute-quote" value={quote} onChange={(event) => setQuote(event.target.value)} />
          </div>
        </>
      )}

      <div className="field">
        <label htmlFor="dispute-reason">Why</label>
        <input
          id="dispute-reason"
          name="reason"
          value={reason}
          maxLength={500}
          required
          placeholder={kind === 'evidence' ? 'They named the budget outright.' : 'That is their budget, not what the problem costs.'}
          onChange={(event) => setReason(event.target.value)}
        />
      </div>
      <p className="muted">
        Recorded as evidence from you, beside the scorecard&apos;s own, and the score is worked out again from both.
        You, or an owner, can withdraw it.
      </p>
      <div className="toolbar">
        <button type="submit" disabled={pending || reason.trim().length < 3}>
          {pending ? 'Recording…' : 'Record correction'}
        </button>
        <button type="button" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
      {state.status === 'error' ? <p role="alert">{state.message}</p> : null}
    </form>
  );
}
