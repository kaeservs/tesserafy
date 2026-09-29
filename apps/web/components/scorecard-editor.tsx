'use client';

import { TableScroll } from '@/components/table-scroll';
import { useActionState, useState } from 'react';
import { publishScorecard, type PublishState } from '@/app/(dashboard)/scorecards/actions';
import {
  DEFINITION_MAX,
  draftProblems,
  keyFor,
  LABEL_MAX,
  MAX_CRITERIA,
  nameFor,
  WEIGHTS,
  type DraftCriterion,
} from '@/lib/scorecard-draft';
import type { TriedCall } from '@/lib/try-scorecard';

export interface EditorStart {
  /** Fixed when this is the next version of the company's own set. */
  readonly name: string | null;
  readonly title: string;
  readonly nextVersion: number;
  readonly criteria: readonly { label: string; definition: string; weight: number }[];
}

interface Row {
  readonly id: number;
  label: string;
  definition: string;
  weight: number;
}

type Trial =
  | { status: 'idle' }
  | { status: 'running' }
  | { status: 'error'; message: string }
  | {
      status: 'tried';
      draft: string;
      criteria: readonly DraftCriterion[];
      calls: readonly TriedCall[];
      rejected: number;
    };

const START: PublishState = { status: 'idle' };

const STATUS_WORDS: Record<string, string> = {
  confirmed: 'Met',
  candidate: 'Partly',
  unobserved: 'Not heard',
  contradicted: 'Contradicted',
};

function clock(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

/**
 * The scorecard editor: criteria in order, each a name, a description and a
 * weight; a trial on recent calls; and publishing.
 *
 * Keys are derived from names rather than typed. A key only has to be unique
 * within one version, and asking a person for a snake_case identifier is
 * asking them to do the machine's job.
 *
 * A trial is tied to the draft it ran on. Change a word after trying and the
 * results say they are stale, because they are: they describe a prompt that
 * no longer exists.
 */
export function ScorecardEditor({ start, templates }: { start: EditorStart; templates: readonly string[] }) {
  const [title, setTitle] = useState(start.title);
  const [rows, setRows] = useState<Row[]>(() =>
    (start.criteria.length > 0
      ? start.criteria
      : [
          { label: '', definition: '', weight: 1 },
          { label: '', definition: '', weight: 1 },
        ]
    ).map((criterion, index) => ({
      id: index,
      label: criterion.label,
      definition: criterion.definition,
      weight: criterion.weight,
    })),
  );
  const [nextId, setNextId] = useState(rows.length);
  const [trial, setTrial] = useState<Trial>({ status: 'idle' });
  const [published, publish, publishing] = useActionState(publishScorecard, START);

  const name = start.name ?? nameFor(title);
  const criteria: DraftCriterion[] = rows.map((row) => ({
    key: keyFor(row.label),
    label: row.label.trim(),
    definition: row.definition.trim(),
    weight: row.weight,
  }));
  const problems = draftProblems(name, criteria, templates);
  const draft = JSON.stringify({ name, criteria });
  const stale = trial.status === 'tried' && trial.draft !== draft;

  const totalWeight = rows.reduce((sum, row) => sum + row.weight, 0);

  function update(id: number, change: Partial<Omit<Row, 'id'>>) {
    setRows((current) => current.map((row) => (row.id === id ? { ...row, ...change } : row)));
  }

  function move(index: number, by: -1 | 1) {
    setRows((current) => {
      const next = [...current];
      const [row] = next.splice(index, 1);
      next.splice(index + by, 0, row!);
      return next;
    });
  }

  async function tryIt() {
    setTrial({ status: 'running' });
    try {
      const response = await fetch('/api/scorecards/try', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: draft,
      });
      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
        calls?: TriedCall[];
        rejected?: number;
      };
      if (!response.ok || !body.calls) {
        setTrial({ status: 'error', message: body.error ?? `That did not work (${response.status}).` });
        return;
      }
      setTrial({ status: 'tried', draft, criteria, calls: body.calls, rejected: body.rejected ?? 0 });
    } catch {
      setTrial({ status: 'error', message: 'Could not reach Tesserafy. Try again.' });
    }
  }

  // Of the draft that ran, not the one on screen: after an edit these describe
  // a prompt that no longer exists, and say so.
  const summary =
    trial.status === 'tried'
      ? trial.criteria.map((criterion) => {
          const across = trial.calls.map((call) => call.criteria.find((found) => found.key === criterion.key));
          const example = across
            .filter((found) => found?.quote)
            .sort((a, b) => (b?.confidence ?? 0) - (a?.confidence ?? 0))[0];
          return {
            key: criterion.key,
            label: criterion.label,
            met: across.filter((found) => found?.status === 'confirmed').length,
            partly: across.filter((found) => found?.status === 'candidate').length,
            example: example?.quote ?? null,
          };
        })
      : [];

  return (
    <div>
      <div className="field">
        <label htmlFor="scorecard-title">Name</label>
        {start.name ? (
          <input id="scorecard-title" value={title} disabled />
        ) : (
          <input
            id="scorecard-title"
            value={title}
            maxLength={40}
            placeholder="Product demo"
            onChange={(event) => setTitle(event.target.value)}
          />
        )}
      </div>

      <h2>Criteria</h2>
      <ol>
        {rows.map((row, index) => (
          <li key={row.id} className="card criterion-edit">
            <div className="criterion-edit-row">
              <div className="field">
                <label htmlFor={`label-${row.id}`}>What should happen</label>
                <input
                  id={`label-${row.id}`}
                  value={row.label}
                  maxLength={LABEL_MAX}
                  placeholder="Next step booked"
                  onChange={(event) => update(row.id, { label: event.target.value })}
                />
              </div>
              <div className="field">
                <label htmlFor={`weight-${row.id}`}>Weight</label>
                <select
                  id={`weight-${row.id}`}
                  value={row.weight}
                  onChange={(event) => update(row.id, { weight: Number(event.target.value) })}
                >
                  {WEIGHTS.map((weight) => (
                    <option key={weight} value={weight}>
                      {weight}
                    </option>
                  ))}
                </select>
              </div>
              <span className="muted" style={{ marginBottom: '0.9rem' }}>
                {totalWeight > 0 ? `${Math.round((row.weight / totalWeight) * 100)}% of the score` : null}
              </span>
            </div>
            <div className="field">
              <label htmlFor={`definition-${row.id}`}>How it sounds on a call</label>
              <textarea
                id={`definition-${row.id}`}
                value={row.definition}
                maxLength={DEFINITION_MAX}
                placeholder="Before the call ends, the customer agrees a dated next meeting, a trial start, or who else should join."
                onChange={(event) => update(row.id, { definition: event.target.value })}
              />
            </div>
            <div className="toolbar">
              <button type="button" onClick={() => move(index, -1)} disabled={index === 0}>
                Move up
              </button>
              <button type="button" onClick={() => move(index, 1)} disabled={index === rows.length - 1}>
                Move down
              </button>
              <button
                type="button"
                onClick={() => setRows((current) => current.filter((other) => other.id !== row.id))}
                disabled={rows.length <= 1}
              >
                Remove
              </button>
            </div>
          </li>
        ))}
      </ol>
      <p>
        <button
          type="button"
          disabled={rows.length >= MAX_CRITERIA}
          onClick={() => {
            setRows((current) => [...current, { id: nextId, label: '', definition: '', weight: 1 }]);
            setNextId(nextId + 1);
          }}
        >
          Add a criterion
        </button>
      </p>

      {problems.length > 0 ? (
        <section aria-labelledby="problems-heading">
          <h2 id="problems-heading">Before it can be tried or published</h2>
          <ul className="problems">
            {problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="try-heading">
        <h2 id="try-heading">Try it on your recent calls</h2>
        <p className="muted">
          Scores up to three of your most recent calls with this draft and saves nothing. It counts as one
          imported call on your plan and takes up to a minute.
        </p>
        <p>
          <button type="button" onClick={() => void tryIt()} disabled={problems.length > 0 || trial.status === 'running'}>
            {trial.status === 'running' ? 'Trying…' : 'Try on recent calls'}
          </button>
        </p>
        {trial.status === 'error' ? <p role="alert">{trial.message}</p> : null}
        {trial.status === 'tried' ? (
          <div aria-live="polite">
            {stale ? (
              <p role="status">
                <strong>You have changed the draft since this trial.</strong> Try again to see how the new
                wording does.
              </p>
            ) : null}
            <TableScroll label="Criteria">
              <table className="team">
                <thead>
                  <tr>
                    <th scope="col">Criterion</th>
                    <th scope="col">Met in</th>
                    <th scope="col">What it heard</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.map((row) => (
                    <tr key={row.key}>
                      <td>{row.label}</td>
                      <td className="when">
                        {row.met} of {trial.calls.length}
                        {row.partly > 0 ? <span className="muted"> ({row.partly} partly)</span> : null}
                      </td>
                      <td>
                        {row.example ? (
                          <q className="tried-quote">{row.example}</q>
                        ) : (
                          <span className="muted">
                            Nothing. The description may not match how people say it — or these calls did not
                            do it.
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScroll>
            <h3>By call</h3>
            <ul>
              {trial.calls.map((call) => (
                <li key={call.id}>
                  <strong>{Math.round(call.score)}</strong> — {call.title}
                  <details>
                    <summary className="muted">Criterion by criterion</summary>
                    <ul>
                      {call.criteria.map((criterion) => (
                        <li key={criterion.key}>
                          {STATUS_WORDS[criterion.status] ?? criterion.status}: {criterion.label}
                          {criterion.quote ? (
                            <q className="tried-quote">
                              {criterion.quote}
                              {criterion.atMs !== null ? ` (${clock(criterion.atMs)})` : ''}
                            </q>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  </details>
                </li>
              ))}
            </ul>
            {trial.rejected > 0 ? (
              <p className="muted">
                {trial.rejected} claim{trial.rejected === 1 ? '' : 's'} dropped for quoting words that were
                not in the call.
              </p>
            ) : null}
          </div>
        ) : null}
      </section>

      <section aria-labelledby="publish-heading">
        <h2 id="publish-heading">Publish</h2>
        <p className="muted">
          {start.name
            ? `Publishes version ${start.nextVersion}. New calls can be scored with it; calls already scored keep the version they had.`
            : 'Makes it available when importing a call. A published version cannot be edited — changing it later publishes the next version.'}
        </p>
        <form action={publish}>
          <input type="hidden" name="draft" value={draft} />
          <button type="submit" disabled={problems.length > 0 || publishing}>
            {publishing ? 'Publishing…' : start.name ? `Publish version ${start.nextVersion}` : 'Publish'}
          </button>
        </form>
        {published.status === 'error' ? <p role="alert">{published.message}</p> : null}
      </section>
    </div>
  );
}
