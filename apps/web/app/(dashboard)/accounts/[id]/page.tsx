import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ManageAccount } from '@/components/account-forms';
import { customerCoverage, scoreTrend, theirPeople } from '@/lib/account-story';
import { accountBrief } from '@/lib/accounts';
import { speakerKey } from '@/lib/talk';
import { batches } from '@tesserafy/db';
import { engagementLabel } from '@/lib/company';
import { OUTCOME_LABEL } from '@/lib/outcome';
import { createClient } from '@/lib/supabase/server';

export const metadata = { title: 'Account · Tesserafy' };

const KIND_LABEL: Record<string, string> = { problem: 'Problem', feature_request: 'Asked for' };

function day(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { dateStyle: 'medium', timeZone: 'UTC' });
}

/**
 * One customer: where the deal stands, what they have said across every call,
 * what colleagues noted, and each call in turn — the brief to read before the
 * next one. Every line under "What they have said" quotes the call it came
 * from and links to the moment (invariant 5).
 */
export default async function AccountPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const brief = await accountBrief(supabase, id);
  if (!brief) notFound();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const [{ data: membership }, { data: team }] = await Promise.all([
    supabase.from('company_members').select('role').eq('user_id', user?.id ?? '').limit(1).maybeSingle(),
    supabase.rpc('company_team'),
  ]);
  const isOwner = membership?.role === 'owner';
  const nameOf = new Map((team ?? []).map((person) => [person.user_id, person.is_you ? 'You' : person.email]));
  const { account, calls, signals, notes } = brief;
  const latest = calls[0];

  // The story across calls: what is established, how the calls have gone,
  // who on their side has been on them, and the themes they feed.
  const coverage = customerCoverage(calls);
  const trend = scoreTrend(calls);
  const callIds = new Set(calls.map((call) => call.id));
  const [{ data: ourRows }, { data: talkRows }, evidence] = await Promise.all([
    supabase.from('our_speakers').select('name'),
    calls.length > 0 ? supabase.rpc('conversation_talk', { p_since: '1970-01-01T00:00:00Z' }) : Promise.resolve({ data: [] }),
    Promise.all(
      batches(signals.map((signal) => signal.id)).map(
        async (ids) => (await supabase.from('insight_evidence').select('insight_id, signal_id').in('signal_id', ids)).data ?? [],
      ),
    ).then((parts) => parts.flat()),
  ]);
  const ours = new Set((ourRows ?? []).map((row) => speakerKey(row.name)));
  const people = theirPeople(
    (talkRows ?? [])
      .filter((row) => callIds.has(row.conversation_id))
      .map((row) => ({ conversationId: row.conversation_id, speaker: row.speaker, words: Number(row.words) })),
    (name) => ours.has(speakerKey(name)),
  );
  const insightIds = [...new Set(evidence.map((row) => row.insight_id))];
  const { data: themeRows } =
    insightIds.length > 0
      ? await supabase.from('insights').select('id, title, status').in('id', insightIds).neq('status', 'dismissed')
      : { data: [] };
  const signalsIn = new Map<string, number>();
  for (const row of evidence) signalsIn.set(row.insight_id, (signalsIn.get(row.insight_id) ?? 0) + 1);
  const themes = (themeRows ?? []).sort((a, b) => (signalsIn.get(b.id) ?? 0) - (signalsIn.get(a.id) ?? 0));
  const y = (score: number) => 58 - (score / 100) * 50;

  return (
    <main>
      <p>
        <Link href="/accounts">← Accounts</Link>
      </p>
      <h1>{account.name}</h1>
      <p className="muted">
        {account.domain ? `${account.domain} · ` : ''}
        {calls.length} call{calls.length === 1 ? '' : 's'}
        {latest ? ` · last ${day(latest.date)}` : ''}
        {account.latestOutcome ? (
          <>
            {' · '}
            <span className={`stage outcome-${account.latestOutcome}`}>{OUTCOME_LABEL[account.latestOutcome]}</span>
          </>
        ) : null}
      </p>
      <p>
        <Link href={`/prep?account=${account.id}`}>Prepare for the next call with {account.name} →</Link>
      </p>
      <ManageAccount
        accountId={account.id}
        name={account.name}
        domain={account.domain}
        mayRename={isOwner || (user !== null && account.createdBy === user.id)}
        mayDelete={isOwner}
        calls={calls.length}
      />

      {coverage.length > 0 ? (
        <section aria-labelledby="standing-heading" className="card">
          <h2 id="standing-heading" style={{ marginTop: 0 }}>
            Where it stands
          </h2>
          {coverage.map((set) => (
            <div key={set.engagementType}>
              {coverage.length > 1 ? (
                <p className="muted" style={{ marginBottom: '0.25rem' }}>
                  {engagementLabel(set.engagementType)}
                </p>
              ) : null}
              {set.stillToFindOut.length > 0 ? (
                <p>
                  <strong>Still to find out:</strong> {set.stillToFindOut.map((criterion) => criterion.label).join(', ')}.
                  <span className="muted"> Not confirmed on any call with them yet, so worth asking next time.</span>
                </p>
              ) : (
                <p>
                  <strong>Every criterion is established</strong> with them on at least one call.
                </p>
              )}
              {set.established.length > 0 ? (
                <p className="muted" style={{ fontSize: '0.88rem' }}>
                  Established:{' '}
                  {set.established.map((criterion, index) => (
                    <span key={criterion.key}>
                      {index > 0 ? ', ' : ''}
                      {criterion.label} (<Link href={`/conversations/${criterion.callId}`}>{criterion.callTitle}</Link>)
                    </span>
                  ))}
                  .
                </p>
              ) : null}
            </div>
          ))}
          {trend.length > 1 ? (
            <figure style={{ margin: '0.5rem 0 0' }}>
              <svg
                viewBox={`0 0 ${(trend.length - 1) * 60 + 20} 64`}
                width={Math.min(480, (trend.length - 1) * 60 + 20)}
                height={64}
                role="img"
                aria-label={`Scores across their calls, oldest first: ${trend.map((point) => Math.round(point.score)).join(', ')}`}
              >
                <polyline
                  fill="none"
                  stroke="currentColor"
                  strokeOpacity={0.4}
                  points={trend.map((point, index) => `${10 + index * 60},${y(point.score)}`).join(' ')}
                />
                {trend.map((point, index) => (
                  <circle key={point.id} cx={10 + index * 60} cy={y(point.score)} r={4} fill="var(--accent)">
                    <title>{`${day(point.date)}: ${Math.round(point.score)}`}</title>
                  </circle>
                ))}
              </svg>
              <figcaption className="muted" style={{ fontSize: '0.82rem' }}>
                Scores across their calls, oldest first: from {Math.round(trend[0]!.score)} to{' '}
                {Math.round(trend[trend.length - 1]!.score)}.
              </figcaption>
            </figure>
          ) : null}
        </section>
      ) : null}

      {people.length > 0 || themes.length > 0 ? (
        <div className="split">
          {people.length > 0 ? (
            <section aria-labelledby="people-heading">
              <h2 id="people-heading">Who we have spoken to</h2>
              <ul className="evidence">
                {people.slice(0, 8).map((person) => (
                  <li key={person.name}>
                    {person.name}{' '}
                    <span className="muted">
                      on {person.calls} call{person.calls === 1 ? '' : 's'}
                    </span>
                  </li>
                ))}
              </ul>
              {ours.size === 0 ? (
                <p className="muted" style={{ fontSize: '0.82rem' }}>
                  Your own people are listed too until someone marks them as one of yours, under Who talked on a call.
                </p>
              ) : null}
            </section>
          ) : null}
          {themes.length > 0 ? (
            <section aria-labelledby="themes-heading">
              <h2 id="themes-heading">Themes they have raised</h2>
              <ul className="evidence">
                {themes.map((theme) => (
                  <li key={theme.id}>
                    <Link href={`/insights/${theme.id}`}>{theme.title}</Link>{' '}
                    <span className="muted">{theme.status === 'proposed' ? 'waiting for a decision' : theme.status}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      ) : null}

      <section aria-labelledby="said-heading">
        <h2 id="said-heading">What they have said</h2>
        {signals.length === 0 ? (
          <p className="muted">
            Nothing read from their calls yet. “Find insights in this call” on a call reads it for problems they
            raised and things they asked for.
          </p>
        ) : (
          <ul className="signals">
            {signals.slice(0, 20).map((signal, index) => (
              <li key={`${signal.conversationId}-${index}`} className="signal">
                <div className="signal-kind muted">{KIND_LABEL[signal.kind] ?? signal.kind}</div>
                <div>{signal.summary}</div>
                {signal.quote && signal.segmentId ? (
                  <ul className="evidence">
                    <li>
                      <Link href={`/conversations/${signal.conversationId}#segment-${signal.segmentId}`}>
                        “{signal.quote}” <span className="muted">— {signal.conversationTitle}</span>
                      </Link>
                    </li>
                  </ul>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      {notes.length > 0 ? (
        <section aria-labelledby="notes-heading">
          <h2 id="notes-heading">Notes</h2>
          <ul className="evidence">
            {notes.slice(0, 10).map((note, index) => (
              <li key={`${note.segmentId}-${index}`}>
                <Link href={`/conversations/${note.conversationId}#segment-${note.segmentId}`}>{note.body}</Link>{' '}
                <span className="muted">
                  — {note.author ? (nameOf.get(note.author) ?? 'a former member') : 'a former member'}, {day(note.at)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="calls-heading">
        <h2 id="calls-heading">Calls</h2>
        {calls.length === 0 ? (
          <p className="muted">None yet.</p>
        ) : (
          <ul className="meetings">
            {calls.map((call) => (
              <li key={call.id} className="meeting">
                <Link href={`/conversations/${call.id}`} className="meeting-title">
                  {call.title}
                </Link>
                <span className="meeting-meta">
                  {day(call.date)} · {engagementLabel(call.engagementType)}
                  {call.outcome ? <span className={`stage outcome-${call.outcome}`}>{OUTCOME_LABEL[call.outcome]}</span> : null}
                </span>
                <span className="meeting-score">
                  {call.score === null ? <span className="muted">not scored</span> : <span className="score-figure">{Math.round(call.score)}</span>}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
