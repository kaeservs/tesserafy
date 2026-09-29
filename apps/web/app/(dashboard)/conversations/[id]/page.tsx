import { TableScroll } from '@/components/table-scroll';
import { engagementLabel, liveAvailable, myCompany } from '@/lib/company';
import { EditCall } from '@/components/edit-call';
import { Corrections, DisputeScore, type Correction } from '@/components/dispute-score';
import { SegmentNotes, type ShownNote } from '@/components/segment-notes';
import { OUTCOME_LABEL } from '@/lib/outcome';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { clock, splitByHighlights } from '@/lib/highlight';
import { Shortfall } from '@/components/criterion-shortfall';
import { conversationPipeline, nextCommand, stageOf } from '@/lib/pipeline';
import { scoreConversation } from '@/lib/scorecard';
import { sideShares, speakerKey, talkStats } from '@/lib/talk';
import { ExtractButton } from '@/components/extract-button';
import { CallViewers } from '@/components/call-viewers';
import { CopyMomentLink } from '@/components/copy-moment-link';
import { AssignCoaching } from '@/components/coaching-forms';
import { OurSpeaker } from '@/components/our-speaker';
import { SaveExample } from '@/components/save-example';
import { DeleteCall } from '@/components/delete-call';
import { RefreshWhile } from '@/components/refresh-while';
import { capturedState, type CapturedState } from '@/lib/scoring-status';
import { batches, fetchCriteriaSets, readAll } from '@tesserafy/db';
import { createClient } from '@/lib/supabase/server';

/**
 * One conversation: what was said, and what was extracted from it.
 *
 * The P1 gate lives here — every signal links to a timestamped quote, and
 * following that link scrolls to the segment and highlights the phrase.
 *
 * No company filter in any of these queries, on purpose. They run as the
 * signed-in user, so RLS decides what comes back. A conversation belonging to
 * another tenant is simply not found.
 */

interface SegmentRow {
  id: string;
  speaker: string | null;
  start_ms: number;
  end_ms: number;
  text: string;
}

interface NoteRow {
  id: string;
  segment_id: string;
  author: string | null;
  body: string;
  created_at: string;
  updated_at: string;
}

interface EditRow {
  field: string;
  old_value: string | null;
  new_value: string | null;
  evidence_removed: number;
  actor: string | null;
  at: string;
}

const FIELD_LABEL: Record<string, string> = {
  title: 'title',
  occurred_at: 'date',
  scorecard: 'scorecard',
  outcome: 'outcome',
};

function stamp(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }) + ' UTC';
}

interface SignalRow {
  id: string;
  kind: string;
  summary: string;
  confidence: number;
}

interface EvidenceRow {
  signal_id: string;
  segment_id: string;
  quote: string;
  quote_start: number;
  quote_end: number;
}

const KIND_LABEL: Record<string, string> = {
  problem: 'Problem',
  feature_request: 'Feature request',
};

/**
 * The terminal command, for whoever operates this deployment — folded away,
 * because a customer looking at their meeting has no terminal and no reason
 * to be shown one.
 */
function OperatorCommand({ command }: { command: string }) {
  return (
    <details style={{ marginTop: '0.75rem' }}>
      <summary className="muted">For operators</summary>
      <code className="command">{command}</code>
    </details>
  );
}

/** What a conversation with no criteria yet is waiting for. */
function CapturedCard({ state, command }: { state: CapturedState; command: string | null }) {
  if (state.kind === 'scoring') {
    return (
      <section aria-labelledby="pipeline-heading" className="card" aria-live="polite">
        <RefreshWhile />
        <h2 id="pipeline-heading" style={{ marginTop: 0 }}>
          Scoring this call…
        </h2>
        <p className="muted" style={{ margin: 0 }}>
          Each part of the conversation is being checked against the criteria. This usually
          takes a minute or two, and the scorecard will appear here on its own.
        </p>
      </section>
    );
  }

  if (state.kind === 'too_long') {
    return (
      <section aria-labelledby="pipeline-heading" className="card">
        <h2 id="pipeline-heading" style={{ marginTop: 0 }}>
          Too long to score automatically
        </h2>
        <p className="muted" style={{ margin: 0 }}>
          This call has {state.windows} passages; automatic scoring takes on calls up to about an
          hour. It has not been scored partially, because a scorecard over the first hour of a
          longer meeting would look complete and be wrong. The Tesserafy team can score it in full.
        </p>
        {command ? <OperatorCommand command={command} /> : null}
      </section>
    );
  }

  return (
    <section aria-labelledby="pipeline-heading" className="card">
      <h2 id="pipeline-heading" style={{ marginTop: 0 }}>
        Not scored yet
      </h2>
      <p className="muted" style={{ margin: 0 }}>
        No criteria have been detected over this call. If it was uploaded recently, scoring did
        not finish — that has been reported. A call captured live is scored as it happens.
      </p>
      {command ? <OperatorCommand command={command} /> : null}
    </section>
  );
}

/**
 * Whether anyone confirmed the people on this call agreed to be recorded.
 *
 * Shown on every call, including the ones with no record: a missing answer
 * said plainly is a fact someone can act on, and leaving it off would let a
 * reader assume the question was asked.
 */
function ConsentRecord({
  statement,
  confirmedAt,
  byYou,
}: {
  statement: string | null;
  confirmedAt: string | null;
  byYou: boolean;
}) {
  if (!statement || !confirmedAt) {
    return (
      <p className="muted">
        No recording consent on file. This call was added before the product asked, or by support
        without one.
      </p>
    );
  }
  return (
    <p className="muted">
      Recording consent confirmed {byYou ? 'by you' : 'by a colleague'} on{' '}
      {new Date(confirmedAt).toLocaleDateString('en-GB')}: “{statement}”
    </p>
  );
}

export default async function ConversationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: conversation } = await supabase
    .from('conversations')
    .select(
      'id, company_id, title, occurred_at, created_at, engagement_type, criteria_version, consent_statement, consent_confirmed_by, consent_confirmed_at, added_by, outcome, account_id, is_sample',
    )
    .eq('id', id)
    .maybeSingle();

  if (!conversation) notFound();
  // Tesserafy's own company still sees the tools it tests with.
  const internal = liveAvailable((await myCompany(supabase))?.plan);

  // Recorded before anything of the call is shown, and a failure to record
  // is a failure to open — the rule support sessions already follow. An
  // access trail with gaps where recording failed answers "did they look?"
  // with "probably not", which is worse than no trail. The same database
  // serves this page, so a failure here is rarely a failure only here.
  const { error: unrecorded } = await supabase.rpc('record_conversation_view', {
    p_conversation_id: id,
  });
  if (unrecorded) throw new Error(`Could not record opening this call: ${unrecorded.message}`);

  // Computed on read from the quoted spans in criterion_events, by the same
  // two pure functions the live overlay runs. Nothing stored is a score
  // (invariant 1), so this page and a call happening right now cannot
  // disagree about what the evidence adds up to.
  // Only an owner may delete a call; erase_conversation refuses anyone else.
  // Read here so the section is not offered to someone it would refuse.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: ownership } = await supabase
    .from('company_members')
    .select('role')
    .eq('user_id', user?.id ?? '')
    .eq('role', 'owner')
    .limit(1);
  const isOwner = (ownership ?? []).length > 0;
  // edit_conversation's own rule, asked here only so the form is not offered
  // to someone it would refuse.
  const mayEdit = isOwner || (user !== null && conversation.added_by === user.id);

  const { data: viewerRows } = isOwner
    ? await supabase.rpc('conversation_viewers', { p_conversation_id: id })
    : { data: null };
  const viewers = (viewerRows ?? []).map((row) => ({
    email: row.email,
    lastViewedAt: row.last_viewed_at,
    views: Number(row.views),
    duringSupport: row.during_support,
  }));

  const scored = await scoreConversation(supabase, conversation);
  const card = scored.scorecard;
  const pipeline = (await conversationPipeline(supabase)).get(id);
  const stage = stageOf(pipeline);
  const command = nextCommand(stage, id);
  // Extraction has run if it stored anything or recorded any usage — a run
  // that found nothing is still a run, and the button must not come back for
  // it. Independent of embedding, which is a separate step.
  const extracted = (pipeline?.signals ?? 0) > 0 || (pipeline?.extractionRuns ?? 0) > 0;
  // Extraction ran and stored nothing. Worth saying plainly rather than
  // leaving a reader to wonder whether the pass is still owed.
  const foundNothing = extracted && (pipeline?.signals ?? 0) === 0;
  const observed = card.criteria.some((criterion) => criterion.status !== 'unobserved');

  const [segments, signals, notes, edits, { data: team }, sets] = await Promise.all([
    readAll<SegmentRow>(
      (from, to) =>
        supabase
          .from('segments')
          .select('id, speaker, start_ms, end_ms, text')
          .eq('conversation_id', id)
          .order('start_ms')
          .order('id')
          .range(from, to),
      'Could not load the conversation',
    ),
    readAll<SignalRow>(
      (from, to) =>
        supabase
          .from('signals')
          .select('id, kind, summary, confidence')
          .eq('conversation_id', id)
          .order('id')
          .range(from, to),
      'Could not load the conversation',
    ),
    readAll<NoteRow>(
      (from, to) =>
        supabase
          .from('segment_notes')
          .select('id, segment_id, author, body, created_at, updated_at')
          .eq('conversation_id', id)
          .order('created_at')
          .order('id')
          .range(from, to),
      'Could not load the notes',
    ),
    readAll<EditRow>(
      (from, to) =>
        supabase
          .from('conversation_edits')
          .select('field, old_value, new_value, evidence_removed, actor, at')
          .eq('conversation_id', id)
          .order('at', { ascending: false })
          .order('id')
          .range(from, to),
      'Could not load the call history',
    ),
    supabase.rpc('company_team'),
    mayEdit ? fetchCriteriaSets(supabase, conversation.company_id) : Promise.resolve([]),
  ]);
  const { data: accountRows } = await supabase.from('accounts').select('id, name').order('name').limit(500);
  const emailOf = new Map((team ?? []).map((person) => [person.user_id, person.is_you ? 'You' : person.email]));
  const nameOf = (userId: string | null) => (userId ? (emailOf.get(userId) ?? 'A former member') : 'A former member');
  // People's corrections to the score: evidence like any other, with who and why.
  const { data: correctionRows } = await supabase
    .from('criterion_events')
    .select('id, criterion_key, kind, quote, segment_id, reason, recorded_by')
    .eq('conversation_id', id)
    .eq('detector', 'person')
    .order('created_at');
  const labelOf = new Map(card.criteria.map((criterion) => [criterion.key, criterion.label]));
  const markedUnmet = new Set(
    (correctionRows ?? []).filter((row) => row.kind === 'contradiction').map((row) => row.criterion_key),
  );
  const corrections: Correction[] = (correctionRows ?? []).map((row) => ({
    id: row.id,
    label: labelOf.get(row.criterion_key) ?? row.criterion_key,
    kind: row.kind === 'contradiction' ? 'contradiction' : 'evidence',
    quote: row.quote,
    segmentId: row.segment_id,
    reason: row.reason ?? '',
    by: nameOf(row.recorded_by),
    mayWithdraw: isOwner || (user !== null && row.recorded_by === user.id),
  }));
  const accountName = (accountRows ?? []).find((row) => row.id === conversation.account_id)?.name ?? null;
  // Which speakers are this company's own people, and which lines are already examples.
  const [{ data: ourRows }, { data: momentRows }] = await Promise.all([
    supabase.from('our_speakers').select('name'),
    supabase.from('moments').select('segment_id, criterion_key').eq('conversation_id', id),
  ]);
  const ours = new Set((ourRows ?? []).map((row) => speakerKey(row.name)));
  const examplesOf = new Map<string, string[]>();
  for (const moment of momentRows ?? []) {
    const list = examplesOf.get(moment.segment_id) ?? [];
    list.push(labelOf.get(moment.criterion_key) ?? moment.criterion_key);
    examplesOf.set(moment.segment_id, list);
  }
  const criterionOptions = card.criteria.map((criterion) => ({ key: criterion.key, label: criterion.label }));

  const notesBySegment = new Map<string, ShownNote[]>();
  for (const note of notes) {
    const shown: ShownNote = {
      id: note.id,
      body: note.body,
      author: nameOf(note.author),
      when: stamp(note.created_at),
      edited: note.updated_at !== note.created_at,
      mine: user !== null && note.author === user.id,
      removable: isOwner || (user !== null && note.author === user.id),
    };
    notesBySegment.set(note.segment_id, [...(notesBySegment.get(note.segment_id) ?? []), shown]);
  }
  // The newest version of each set, and the call's own pin whatever its age,
  // so the form never silently proposes a different one.
  const pinned = `${conversation.engagement_type}/${conversation.criteria_version}`;
  const scorecards = [
    ...sets
      .filter((set) => !sets.some((other) => other.engagementType === set.engagementType && other.version > set.version))
      .map((set) => ({
        value: `${set.engagementType}/${set.version}`,
        label: `${engagementLabel(set.engagementType)}${set.own ? '' : ' (template)'}, version ${set.version}`,
      })),
  ];
  if (mayEdit && !scorecards.some((choice) => choice.value === pinned)) {
    scorecards.unshift({
      value: pinned,
      label: `${engagementLabel(conversation.engagement_type)}, version ${conversation.criteria_version} (current)`,
    });
  }

  // Evidence is fetched separately rather than embedded: signal_evidence
  // reaches signals through a composite (company_id, signal_id) key, which
  // PostgREST cannot resolve into an embed. For this call's signals only: it
  // used to read the whole company's evidence and filter here, which stops
  // being all of it at a thousand rows — and the quotes that went missing
  // would have been whichever the server returned last.
  const evidence = (
    await Promise.all(
      batches(signals.map((signal) => signal.id)).map((ids) =>
        readAll<EvidenceRow>(
          (from, to) =>
            supabase
              .from('signal_evidence')
              .select('signal_id, segment_id, quote, quote_start, quote_end')
              .in('signal_id', ids)
              .order('id')
              .range(from, to),
          'Could not load the conversation',
        ),
      ),
    )
  ).flat();

  const evidenceBySignal = new Map<string, EvidenceRow[]>();
  const rangesBySegment = new Map<string, { start: number; end: number }[]>();
  for (const row of evidence) {
    evidenceBySignal.set(row.signal_id, [...(evidenceBySignal.get(row.signal_id) ?? []), row]);
    rangesBySegment.set(row.segment_id, [
      ...(rangesBySegment.get(row.segment_id) ?? []),
      { start: row.quote_start, end: row.quote_end },
    ]);
  }

  const startedAt = new Map(segments.map((segment) => [segment.id, segment.start_ms]));
  const talk = talkStats(segments);
  const split = sideShares(talk.speakers, ours);
  const { title, occurred_at: occurredAt } = conversation as {
    title: string;
    occurred_at: string | null;
  };

  return (
    <main>
      <p>
        <Link href="/conversations">← Meetings</Link>
      </p>
      <h1>{title}</h1>
      {conversation.is_sample ? (
        <p className="card sample-note">
          This is Tesserafy&apos;s sample call: invented, and nobody was recorded. It is scored exactly as your own calls
          will be — open a quote to see the words behind a criterion, or notice what was never asked. Delete it at the
          bottom of the page whenever you like; it is not counted against your plan.
        </p>
      ) : null}
      {internal ? (
        <p className="muted">
          <Link href={`/live/${id}`}>Replay as a live scorecard →</Link>
        </p>
      ) : null}
      <p className="muted">
        {occurredAt ? new Date(occurredAt).toLocaleDateString('en-GB') : 'Date unknown'} ·{' '}
        {segments.length} transcript line{segments.length === 1 ? '' : 's'} · {signals.length} signal
        {signals.length === 1 ? '' : 's'} ·{' '}
        {engagementLabel(scored.engagementType)}
        {accountName ? (
          <>
            {' · with '}
            <Link href={`/accounts/${conversation.account_id}`}>{accountName}</Link>
          </>
        ) : null}
        {conversation.outcome ? (
          <>
            {' · '}
            <span className={`stage outcome-${conversation.outcome}`}>{OUTCOME_LABEL[conversation.outcome]}</span>
          </>
        ) : null}
      </p>
      {mayEdit ? (
        <EditCall
          conversationId={id}
          title={title}
          date={occurredAt?.slice(0, 10) ?? ''}
          scorecard={pinned}
          outcome={conversation.outcome ?? 'unknown'}
          scorecards={scorecards}
          account={accountName ?? ''}
          accounts={(accountRows ?? []).map((row) => row.name)}
        />
      ) : null}
      {/* The sample's note says what it is; "consent confirmed by you" would not be true of it. */}
      {conversation.is_sample ? null : (
        <ConsentRecord
          statement={conversation.consent_statement}
          confirmedAt={conversation.consent_confirmed_at}
          byYou={Boolean(user && conversation.consent_confirmed_by === user.id)}
        />
      )}

      {/*
        Where this call has got to, and what would move it on.
        An imported transcript arrives finished, so this says nothing for
        most conversations. A live-captured one does not, and without this it
        is indistinguishable from a finished call that simply scored badly —
        which is the opposite fact.
      */}
      {command && stage === 'captured' ? (
        <CapturedCard
          state={capturedState(segments.length, conversation.created_at)}
          command={internal ? command : null}
        />
      ) : null}

      {stage === 'scored' && !extracted ? (
        <section aria-labelledby="pipeline-heading" className="card">
          <h2 id="pipeline-heading" style={{ marginTop: 0 }}>
            Find what this call says
          </h2>
          <p className="muted">
            The scorecard shows which criteria this conversation met. Reading it for problems the
            customer raised and things they asked for is a separate pass over the whole call, by a
            larger model. Every signal it finds is quoted word for word from the transcript.
          </p>
          <ExtractButton conversationId={id} />
          {command && internal ? <OperatorCommand command={command} /> : null}
        </section>
      ) : null}

      <section aria-labelledby="scorecard-heading">
        <h2 id="scorecard-heading">Scorecard</h2>
        {!observed ? (
          <p className="muted">
            Not scored yet — which is not the same as scoring zero. The card above says where
            it has got to.
          </p>
        ) : (
          <>
            <p>
              <span className="score">{Math.round(card.score)}</span>
              <span className="score-unit">
                {' '}
                / 100 · {card.earnedWeight} of {card.totalWeight} confirmed
              </span>
            </p>
            <ul className="signals">
              {card.criteria.map((criterion) => (
                <li key={criterion.key} className="signal">
                  <div className="criterion">
                    <span>
                      {criterion.label}
                      {/* A person's "it wasn't met" is a verdict, and later evidence
                          does not overturn it; "one more mention" would be untrue. */}
                      {criterion.status === 'contradicted' && markedUnmet.has(criterion.key) ? (
                        <span className="shortfall"> marked not met — see Corrections</span>
                      ) : (
                        <Shortfall shortfall={criterion.shortfall} />
                      )}
                    </span>
                    <span className={`state state-${criterion.status}`}>{criterion.status}</span>
                  </div>
                  {/* Every state above rests on something somebody said, and
                      the quote is a link to where they said it — invariant 4
                      is not a claim this page makes, it is one it shows. */}
                  {criterion.evidence.length > 0 && (
                    <ul className="evidence">
                      {criterion.evidence.map((recorded) => (
                        <li key={`${recorded.span.segmentId}-${recorded.seq}`}>
                          <a href={`#segment-${recorded.span.segmentId}`}>
                            “{recorded.span.quote}”{' '}
                            <span className="muted">at {clock(recorded.span.startMs)}</span>
                          </a>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
            <p className="muted" style={{ fontSize: '0.82rem' }}>
              Scored against the {engagementLabel(scored.engagementType)} criteria, from the
              quotes above. The score is worked out again each time this page loads.
            </p>
          </>
        )}
        <Corrections conversationId={id} corrections={corrections} />
        {mayEdit && segments.length > 0 ? (
          <DisputeScore
            conversationId={id}
            criteria={card.criteria.map((criterion) => ({
              key: criterion.key,
              label: criterion.label,
              status: criterion.status,
              claims: criterion.evidence.map((recorded) => ({ segmentId: recorded.span.segmentId, quote: recorded.span.quote })),
            }))}
            moments={segments.map((segment) => ({
              id: segment.id,
              at: clock(segment.start_ms),
              speaker: segment.speaker ?? 'unknown',
              text: segment.text,
            }))}
          />
        ) : null}
      </section>

      {talk.speakers.length > 0 ? (
        <section aria-labelledby="talk-heading" className="card">
          <h2 id="talk-heading" style={{ marginTop: 0 }}>
            Who talked
          </h2>
          {split ? (
            <p>
              Your side talked <strong>{Math.round(split.ours * 100)}%</strong> of the time, the customer{' '}
              {Math.round(split.theirs * 100)}%.
            </p>
          ) : (
            <p className="muted">
              Mark who is one of yours and this shows your side against the customer&apos;s, here and on Reports. A name
              marked once counts on every call.
            </p>
          )}
          <TableScroll label="Who talked">
            <table className="team">
              <thead>
                <tr>
                  <th scope="col">Speaker</th>
                  <th scope="col">Share of the words</th>
                  <th scope="col">Questions</th>
                  <th scope="col">Longest stretch</th>
                  <th scope="col">
                    <span className="visually-hidden">Your side</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {talk.speakers.map((speaker) => (
                  <tr key={speaker.speaker ?? ''}>
                    <td>
                      {speaker.speaker ?? <span className="muted">Not named in the transcript</span>}
                      {speaker.speaker !== null && ours.has(speakerKey(speaker.speaker)) ? (
                        <span className="stage stage-approved"> yours</span>
                      ) : null}
                    </td>
                    <td>
                      <span className="share-bar" aria-hidden="true">
                        <span style={{ width: `${Math.round(speaker.share * 100)}%` }} />
                      </span>{' '}
                      {Math.round(speaker.share * 100)}%
                    </td>
                    <td>{speaker.questions}</td>
                    <td className="when">
                      {speaker.longestWords} words{speaker.longestMs >= 1000 ? `, ${duration(speaker.longestMs)}` : ''}
                    </td>
                    <td>
                      {speaker.speaker !== null ? (
                        <OurSpeaker conversationId={id} speaker={speaker.speaker} ours={ours.has(speakerKey(speaker.speaker))} />
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
          <p className="muted" style={{ marginBottom: 0, fontSize: '0.82rem' }}>
            Counted from the transcript by words, so it reads the same whatever the format. It is not part of the score.
          </p>
        </section>
      ) : null}

      <section aria-labelledby="signals-heading">
        <h2 id="signals-heading">Signals</h2>
        {signals.length === 0 ? (
          <p className="muted">
            {foundNothing
              ? 'Extraction has run over this call and found nothing it could evidence. ' +
                'That is an answer, not an omission — a conversation with no stated problem ' +
                'and no request produces no signals.'
              : 'Nothing read from this call yet.'}
          </p>
        ) : (
          <ul className="signals">
            {signals.map((signal) => (
              <li key={signal.id} className="signal">
                <div className="signal-kind muted">{KIND_LABEL[signal.kind] ?? signal.kind}</div>
                <div>{signal.summary}</div>
                <ul className="evidence">
                  {(evidenceBySignal.get(signal.id) ?? []).map((item) => (
                    <li key={`${item.signal_id}-${item.segment_id}-${item.quote_start}`}>
                      {/* The whole point of the gate: the claim is a link to
                          the words it came from. */}
                      <a href={`#segment-${item.segment_id}`}>
                        “{item.quote}” <span className="muted">at {clock(startedAt.get(item.segment_id) ?? 0)}</span>
                      </a>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </section>

      {notes.length > 0 ? (
        <section aria-labelledby="notes-heading">
          <h2 id="notes-heading">Notes ({notes.length})</h2>
          <ul className="evidence">
            {notes.map((note) => (
              <li key={note.id}>
                <a href={`#segment-${note.segment_id}`}>
                  {note.body.length > 140 ? `${note.body.slice(0, 140)}…` : note.body}{' '}
                  <span className="muted">
                    {nameOf(note.author)}, at {clock(startedAt.get(note.segment_id) ?? 0)}
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="transcript-heading">
        <h2 id="transcript-heading">Transcript</h2>
        {segments.length === 0 ? (
          <p className="muted">This conversation has no segments.</p>
        ) : (
          <ol className="transcript">
            {segments.map((segment) => (
              <li key={segment.id} id={`segment-${segment.id}`} className="segment">
                <div className="muted segment-meta">
                  <a href={`#segment-${segment.id}`} className="moment-time">
                    {clock(segment.start_ms)}
                  </a>{' '}
                  · {segment.speaker ?? 'unknown'} <CopyMomentLink conversationId={id} segmentId={segment.id} />
                </div>
                <p>
                  {splitByHighlights(segment.text, rangesBySegment.get(segment.id) ?? []).map(
                    (piece, index) =>
                      piece.highlighted ? (
                        <mark key={index}>{piece.text}</mark>
                      ) : (
                        <span key={index}>{piece.text}</span>
                      ),
                  )}
                </p>
                <SegmentNotes
                  conversationId={id}
                  segmentId={segment.id}
                  notes={notesBySegment.get(segment.id) ?? []}
                />
                <SaveExample
                  conversationId={id}
                  segmentId={segment.id}
                  criteria={criterionOptions}
                  savedAs={examplesOf.get(segment.id) ?? []}
                />
              </li>
            ))}
          </ol>
        )}
      </section>
      {edits.length > 0 ? (
        <details className="call-history">
          <summary className="muted">Changes to this call ({edits.length})</summary>
          <ul className="muted">
            {edits.map((edit) => (
              <li key={`${edit.at}-${edit.field}`}>
                {stamp(edit.at)} — {nameOf(edit.actor)} changed the {FIELD_LABEL[edit.field] ?? edit.field}
                {edit.field === 'occurred_at'
                  ? ` to ${edit.new_value ? edit.new_value.slice(0, 10) : 'none'}`
                  : edit.field === 'outcome'
                    ? ` to ${edit.new_value ? (OUTCOME_LABEL[edit.new_value] ?? edit.new_value) : 'not said'}`
                    : ` from “${edit.old_value ?? ''}” to “${edit.new_value ?? ''}”`}
                {edit.evidence_removed > 0
                  ? `, removing ${edit.evidence_removed} piece${edit.evidence_removed === 1 ? '' : 's'} of evidence scored against the old one`
                  : ''}
                .
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      {isOwner ? (
        <AssignCoaching
          conversationId={id}
          people={(team ?? []).map((person) => ({ id: person.user_id, label: person.is_you ? `${person.email} (you)` : person.email }))}
          moments={segments.map((segment) => ({
            id: segment.id,
            label: `${clock(segment.start_ms)} ${segment.speaker ?? 'unknown'}: ${segment.text.length > 60 ? `${segment.text.slice(0, 60)}…` : segment.text}`,
          }))}
        />
      ) : null}
      {isOwner ? <CallViewers viewers={viewers} /> : null}
      {isOwner ? <DeleteCall conversationId={id} /> : null}
    </main>
  );
}

/** A stretch of speech: "45 s", "3 min 20 s". */
function duration(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds} s`;
  const rest = seconds % 60;
  return `${Math.floor(seconds / 60)} min${rest > 0 ? ` ${rest} s` : ''}`;
}
