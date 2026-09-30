'use client';

import { useActionState, useEffect, useState } from 'react';
import { addInstruction, setCallType, type GuidanceState } from '@/app/(dashboard)/guidance/actions';

const START: GuidanceState = { status: 'idle' };

const PURPOSE_OPTIONS: readonly { value: string; label: string }[] = [
  { value: 'sales', label: 'Sales' },
  { value: 'customer_success', label: 'Customer success' },
  { value: 'support', label: 'Support' },
  { value: 'recruiting', label: 'Recruiting' },
  { value: 'internal', label: 'Internal' },
  { value: 'other', label: 'Other' },
];

/**
 * One scorecard's call type, and whether new imports use it. Every AI feature
 * leans the way the call type says — a sales call's prep looks for buying
 * signals, a support call's action items for what was promised.
 */
export function CallTypeForm({
  engagementType,
  label,
  purpose,
  isDefault,
}: {
  engagementType: string;
  label: string;
  purpose: string;
  isDefault: boolean;
}) {
  const [value, setValue] = useState(purpose);
  const [makeDefault, setMakeDefault] = useState(isDefault);
  const [state, action, pending] = useActionState(setCallType, START);
  return (
    <form action={action} className="call-type-form">
      <input type="hidden" name="engagementType" value={engagementType} />
      <span className="call-type-name">{label}</span>
      <label className="visually-hidden" htmlFor={`purpose-${engagementType}`}>
        {label} calls are
      </label>
      <select id={`purpose-${engagementType}`} name="purpose" value={value} onChange={(event) => setValue(event.target.value)}>
        {PURPOSE_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <label className="call-type-default">
        <input type="checkbox" name="makeDefault" value="yes" checked={makeDefault} onChange={(event) => setMakeDefault(event.target.checked)} disabled={isDefault} />{' '}
        {isDefault ? 'Default for new imports' : 'Make it the default'}
      </label>
      <button type="submit" disabled={pending}>
        {pending ? 'Saving…' : 'Save'}
      </button>
      {state.status === 'saved' ? <span role="status" className="muted"> {state.message}</span> : null}
      {state.status === 'error' ? <span role="alert"> {state.message}</span> : null}
    </form>
  );
}

/** An owner's instruction to one AI feature. Fields held in state, as React resets a form after its action. */
export function AddInstruction({
  scorecards,
  criteria,
}: {
  scorecards: readonly { value: string; label: string }[];
  criteria: readonly { engagementType: string; key: string; label: string }[];
}) {
  const [feature, setFeature] = useState('scoring');
  const [engagementType, setEngagementType] = useState('');
  const [criterionKey, setCriterionKey] = useState('');
  const [body, setBody] = useState('');
  const [state, action, pending] = useActionState(addInstruction, START);

  useEffect(() => {
    if (state.status === 'saved') setBody('');
  }, [state]);

  const criteriaHere = criteria.filter((criterion) => !engagementType || criterion.engagementType === engagementType);
  return (
    <form action={action} className="card">
      <h3 style={{ marginTop: 0 }}>Tell the AI something</h3>
      <div className="field">
        <label htmlFor="guidance-feature">For</label>
        <select id="guidance-feature" name="feature" value={feature} onChange={(event) => { setFeature(event.target.value); setCriterionKey(''); }}>
          <option value="scoring">Scoring</option>
          <option value="insights">Finding insights in a call</option>
          <option value="action_items">Action items</option>
          <option value="prep">Call prep</option>
        </select>
      </div>
      <div className="field">
        <label htmlFor="guidance-type">On</label>
        <select id="guidance-type" name="engagementType" value={engagementType} onChange={(event) => { setEngagementType(event.target.value); setCriterionKey(''); }}>
          <option value="">Every call type</option>
          {scorecards.map((scorecard) => (
            <option key={scorecard.value} value={scorecard.value}>
              {scorecard.label} calls
            </option>
          ))}
        </select>
      </div>
      {feature === 'scoring' ? (
        <div className="field">
          <label htmlFor="guidance-criterion">About (optional)</label>
          <select id="guidance-criterion" name="criterionKey" value={criterionKey} onChange={(event) => setCriterionKey(event.target.value)}>
            <option value="">Every criterion</option>
            {criteriaHere.map((criterion) => (
              <option key={`${criterion.engagementType}/${criterion.key}`} value={criterion.key}>
                {criterion.label}
              </option>
            ))}
          </select>
        </div>
      ) : null}
      <div className="field">
        <label htmlFor="guidance-body">What it should know</label>
        <textarea
          id="guidance-body"
          name="body"
          rows={3}
          maxLength={1000}
          value={body}
          onChange={(event) => setBody(event.target.value)}
          placeholder={
            feature === 'action_items'
              ? 'On sales calls, say who owns each next step and by when.'
              : feature === 'scoring'
                ? 'Approved headcount counts as budget for us.'
                : feature === 'prep'
                  ? 'Lead with how they measure success today.'
                  : 'Treat integration requests as feature requests, not problems.'
          }
        />
      </div>
      <button type="submit" disabled={pending || body.trim().length === 0}>
        {pending ? 'Saving…' : 'Save instruction'}
      </button>
      {state.status === 'saved' ? <p role="status">{state.message}</p> : null}
      {state.status === 'error' ? <p role="alert">{state.message}</p> : null}
    </form>
  );
}
