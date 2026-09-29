import Link from 'next/link';
import { notFound } from 'next/navigation';
import { batches, readAll } from '@tesserafy/db';
import { MIN_DECIDED, percent, sellerProfile } from '@/lib/coaching';
import { loadCoachingCalls } from '@/lib/coaching-data';
import { engagementLabel } from '@/lib/company';
import { clock } from '@/lib/highlight';
import { OUTCOME_LABEL } from '@/lib/outcome';
import { speakerKey, talkBySeller } from '@/lib/talk';
import { createClient } from '@/lib/supabase/server';

export const metadata = { title: 'Seller · Tesserafy' };

interface NoteRow {
  id: string;
  conversation_id: string;
  segment_id: string;
  author: string | null;
  body: string;
  created_at: string;
}

function score(value: number | null): string {
  return value === null ? '—' : String(Math.round(value));
}

function day(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { dateStyle: 'medium', timeZone: 'UTC' });
}

/**
 * One seller: their calls, how they end, where they differ from the company,
 * and what colleagues have noted on their calls.
 *
 * Owners open anyone's; a member opens only their own — the line Reports
 * draws, so a colleague's numbers are never one URL away.
 */
export default async function SellerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const [{ data: membership }, { data: team }] = await Promise.all([
    supabase.from('company_members').select('role').eq('user_id', user?.id ?? '').limit(1).maybeSingle(),
    supabase.rpc('company_team'),
  ]);
  const isOwner = membership?.role === 'owner';
  const person = (team ?? []).find((member) => member.user_id === id);
  if (!person || (!isOwner && id !== user?.id)) notFound();

  const [calls, { data: goalRows }, { data: ourRows }] = await Promise.all([
    loadCoachingCalls(supabase),
    supabase.from('criterion_goals').select('engagement_type, criterion_key, target'),
    supabase.from('our_speakers').select('name'),
  ]);
  const goalOf = new Map((goalRows ?? []).map((row) => [`${row.engagement_type}/${row.criterion_key}`, Number(row.target)]));
  const ours = new Set((ourRows ?? []).map((row) => speakerKey(row.name)));
  const profile = sellerProfile(calls, id);
  const theirs = calls
    .filter((call) => call.addedBy === id)
    .sort((a, b) => b.date.localeCompare(a.date));

  const emailOf = new Map((team ?? []).map((member) => [member.user_id, member.is_you ? 'You' : member.email]));
  const notes = (
    await Promise.all(
      batches(theirs.map((call) => call.id)).map((ids) =>
        readAll<NoteRow>(
          (from, to) =>
            supabase
              .from('segment_notes')
              .select('id, conversation_id, segment_id, author, body, created_at')
              .in('conversation_id', ids)
              .order('id')
              .range(from, to),
          'Could not load notes',
        ),
      ),
    )
  )
    .flat()
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, 20);
  const { data: noteSegments } =
    notes.length > 0
      ? await supabase.from('segments').select('id, start_ms').in('id', notes.map((note) => note.segment_id))
      : { data: [] };
  const startOf = new Map((noteSegments ?? []).map((segment) => [segment.id, segment.start_ms]));
  const titleOf = new Map(theirs.map((call) => [call.id, call.title]));
  const decided = profile.outcomes.won + profile.outcomes.lost;
  const { data: talkRows } = ours.size > 0 ? await supabase.rpc('conversation_talk', { p_since: '1970-01-01T00:00:00Z' }) : { data: [] };
  const theirIds = new Set(theirs.map((call) => call.id));
  const talked = talkBySeller(
    (talkRows ?? [])
      .filter((row) => theirIds.has(row.conversation_id))
      .map((row) => ({ conversationId: row.conversation_id, speaker: row.speaker, words: Number(row.words) })),
    ours,
    new Map(theirs.map((call) => [call.id, call.addedBy])),
  ).get(id);

  return (
    <main>
      <p>
        <Link href="/reports">← Reports</Link>
      </p>
      <h1>{person.is_you ? 'Your calls' : person.email}</h1>
      <p className="muted">
        Every call {person.is_you ? 'you have' : 'they have'} added, against the whole company. Scores come from
        the quoted evidence on each call; calls nothing has been heard on yet are left out of the averages.
      </p>

      <div className="grid" style={{ marginTop: '1.5rem' }}>
        <div className="card">
          <span className="stat-value">{profile.calls}</span>
          <span className="stat-label">calls, {profile.scored} scored</span>
        </div>
        <div className="card">
          <span className="stat-value">{score(profile.average)}</span>
          <span className="stat-label">average score · company {score(profile.companyAverage)}</span>
        </div>
        <div className="card">
          <span className="stat-value">{profile.winRate === null ? '—' : percent(profile.winRate)}</span>
          <span className="stat-label">
            {profile.winRate === null
              ? `won — needs ${MIN_DECIDED} won or lost calls (${decided} so far)`
              : `won, of ${decided} decided · company ${profile.companyWinRate === null ? '—' : percent(profile.companyWinRate)}`}
          </span>
        </div>
        {talked ? (
          <div className="card">
            <span className="stat-value">{percent(talked.share)}</span>
            <span className="stat-label">
              of the talking was {person.is_you ? 'your' : 'their'} side&apos;s, over {talked.calls} call{talked.calls === 1 ? '' : 's'}
            </span>
          </div>
        ) : null}
      </div>
      <p className="muted">
        {profile.outcomes.won} won · {profile.outcomes.lost} lost · {profile.outcomes.open} still open ·{' '}
        {profile.outcomes.unsaid} with no outcome yet.
      </p>

      <section aria-labelledby="criteria-heading">
        <h2 id="criteria-heading">Criteria, against the company</h2>
        {profile.criteria.length === 0 ? (
          <p className="muted">
            Needs {MIN_DECIDED} scored calls on the same scorecard before a criterion is compared.
          </p>
        ) : (
          <>
            <table className="team">
              <thead>
                <tr>
                  <th scope="col">Criterion</th>
                  <th scope="col">{person.is_you ? 'You' : 'Them'}</th>
                  <th scope="col">Company</th>
                  <th scope="col">Calls</th>
                  <th scope="col">Goal</th>
                </tr>
              </thead>
              <tbody>
                {profile.criteria.map((row) => (
                  <tr key={`${row.engagementType}/${row.key}`}>
                    <td>
                      {row.label} <span className="muted">· {engagementLabel(row.engagementType)}</span>
                    </td>
                    <td>{percent(row.rate)}</td>
                    <td className="muted">{percent(row.companyRate)}</td>
                    <td className="muted">{row.calls}</td>
                    <td>
                      {goalOf.has(`${row.engagementType}/${row.key}`) ? (
                        <>
                          {percent(goalOf.get(`${row.engagementType}/${row.key}`)!)}
                          <span className={row.rate >= goalOf.get(`${row.engagementType}/${row.key}`)! ? 'muted' : 'shortfall'}>
                            {row.rate >= goalOf.get(`${row.engagementType}/${row.key}`)! ? ' met' : ' below'}
                          </span>
                        </>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="muted" style={{ fontSize: '0.82rem' }}>
              How often each criterion was met on scored calls, weakest against the company first.
            </p>
          </>
        )}
      </section>

      <section aria-labelledby="notes-heading">
        <h2 id="notes-heading">Notes on {person.is_you ? 'your' : 'their'} calls</h2>
        {notes.length === 0 ? (
          <p className="muted">None yet. Anyone in the company can add a note under a line of a call’s transcript.</p>
        ) : (
          <ul className="evidence">
            {notes.map((note) => (
              <li key={note.id}>
                <Link href={`/conversations/${note.conversation_id}#segment-${note.segment_id}`}>{note.body}</Link>{' '}
                <span className="muted">
                  — {note.author ? (emailOf.get(note.author) ?? 'a former member') : 'a former member'},{' '}
                  {titleOf.get(note.conversation_id)} at {clock(startOf.get(note.segment_id) ?? 0)}, {day(note.created_at)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="calls-heading">
        <h2 id="calls-heading">Recent calls</h2>
        {theirs.length === 0 ? (
          <p className="muted">None yet.</p>
        ) : (
          <>
            <ul className="meetings">
              {theirs.slice(0, 10).map((call) => (
                <li key={call.id} className="meeting">
                  <Link href={`/conversations/${call.id}`} className="meeting-title">
                    {call.title}
                  </Link>
                  <span className="meeting-meta">
                    {day(call.date)} · {engagementLabel(call.engagementType)}
                    {call.outcome ? (
                      <span className={`stage outcome-${call.outcome}`}>{OUTCOME_LABEL[call.outcome]}</span>
                    ) : null}
                  </span>
                  <span className="meeting-score">
                    {call.score === null ? <span className="muted">not scored</span> : (
                      <span className="score-figure">{Math.round(call.score)}</span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
            {theirs.length > 10 ? (
              <p>
                <Link href={`/conversations?seller=${person.is_you ? 'mine' : id}`}>
                  All {theirs.length} in Meetings →
                </Link>
              </p>
            ) : null}
          </>
        )}
      </section>
    </main>
  );
}
