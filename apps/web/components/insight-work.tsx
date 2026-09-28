'use client';

import { useActionState, useEffect, useState } from 'react';
import {
  assignInsight,
  commentInsight,
  editInsight,
  mergeInsight,
  type WorkState,
} from '@/app/(dashboard)/insights/[id]/work-actions';

const START: WorkState = { status: 'idle' };

function Message({ state }: { state: WorkState }) {
  if (state.status === 'error') return <p role="alert">{state.message}</p>;
  if (state.status === 'saved' && state.message) return <p role="status">{state.message}</p>;
  return null;
}

/**
 * Working an insight: its wording, who owns it, and — for an owner — folding
 * a duplicate into it. Closed by default; most visits are to read it.
 */
export function WorkOnInsight({
  insightId,
  title,
  summary,
  assignee,
  team,
  others,
  isOwner,
}: {
  insightId: string;
  title: string;
  summary: string;
  assignee: string | null;
  team: readonly { id: string; email: string }[];
  others: readonly { id: string; title: string }[];
  isOwner: boolean;
}) {
  const [edited, edit, editing] = useActionState(editInsight, START);
  const [assigned, assign, assigning] = useActionState(assignInsight, START);
  const [merged, merge, merging] = useActionState(mergeInsight, START);
  const [confirmMerge, setConfirmMerge] = useState(false);
  const [mergeId, setMergeId] = useState(others[0]?.id ?? '');
  // Held in state: React resets uncontrolled fields after a submission.
  const [draftTitle, setDraftTitle] = useState(title);
  const [draftSummary, setDraftSummary] = useState(summary);

  return (
    <details className="card edit-call">
      <summary>Work on this insight</summary>

      <form action={assign} className="toolbar" style={{ marginTop: '0.75rem', alignItems: 'flex-end' }}>
        <input type="hidden" name="insightId" value={insightId} />
        <div className="field" style={{ marginBottom: 0 }}>
          <label htmlFor="assignee">Owned by</label>
          <select id="assignee" name="assignee" defaultValue={assignee ?? ''}>
            <option value="">Nobody yet</option>
            {team.map((person) => (
              <option key={person.id} value={person.id}>
                {person.email}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" disabled={assigning}>
          Assign
        </button>
      </form>
      <Message state={assigned} />

      <form action={edit} style={{ marginTop: '1rem' }}>
        <input type="hidden" name="insightId" value={insightId} />
        <div className="field" style={{ maxWidth: 'none' }}>
          <label htmlFor="insight-title">Title</label>
          <input id="insight-title" name="title" maxLength={200} required value={draftTitle} onChange={(event) => setDraftTitle(event.target.value)} />
        </div>
        <div className="field segment-notes" style={{ maxWidth: 'none' }}>
          <label htmlFor="insight-summary">Summary</label>
          <textarea id="insight-summary" name="summary" maxLength={2000} required value={draftSummary} onChange={(event) => setDraftSummary(event.target.value)} />
        </div>
        <button type="submit" disabled={editing}>
          Save wording
        </button>
        <span className="muted"> The evidence below is never edited.</span>
      </form>
      <Message state={edited} />

      {isOwner && others.length > 0 ? (
        <form action={merge} style={{ marginTop: '1rem' }}>
          <input type="hidden" name="insightId" value={insightId} />
          <input type="hidden" name="mergeId" value={mergeId} />
          <div className="field" style={{ maxWidth: 'none' }}>
            <label htmlFor="merge-id">Fold a duplicate into this one</label>
            <select id="merge-id" value={mergeId} onChange={(event) => setMergeId(event.target.value)}>
              {others.map((other) => (
                <option key={other.id} value={other.id}>
                  {other.title}
                </option>
              ))}
            </select>
          </div>
          {confirmMerge ? (
            <div className="toolbar">
              <span>Its citations join this insight, and it is removed.</span>
              <button type="submit" disabled={merging}>
                {merging ? 'Merging…' : 'Yes, merge'}
              </button>
              <button type="button" onClick={() => setConfirmMerge(false)}>
                Cancel
              </button>
            </div>
          ) : (
            <button type="button" onClick={() => setConfirmMerge(true)}>
              Merge…
            </button>
          )}
          <Message state={merged} />
        </form>
      ) : null}
    </details>
  );
}

/** The discussion under an insight. */
export function CommentOnInsight({ insightId }: { insightId: string }) {
  const [state, comment, pending] = useActionState(commentInsight, START);
  const [body, setBody] = useState('');
  useEffect(() => {
    if (state.status === 'saved') setBody('');
  }, [state]);
  return (
    <form action={comment} className="segment-notes">
      <input type="hidden" name="insightId" value={insightId} />
      <label htmlFor="comment-body" className="visually-hidden">
        Add to the discussion
      </label>
      <textarea
        id="comment-body"
        name="body"
        maxLength={2000}
        placeholder="Is this worth building? Who has seen it?"
        value={body}
        onChange={(event) => setBody(event.target.value)}
      />
      <button type="submit" disabled={pending || body.trim().length === 0}>
        {pending ? 'Posting…' : 'Comment'}
      </button>
      <Message state={state} />
    </form>
  );
}
