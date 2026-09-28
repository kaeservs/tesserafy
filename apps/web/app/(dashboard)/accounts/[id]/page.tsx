import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ManageAccount } from '@/components/account-forms';
import { accountBrief } from '@/lib/accounts';
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
      <ManageAccount
        accountId={account.id}
        name={account.name}
        domain={account.domain}
        mayRename={isOwner || (user !== null && account.createdBy === user.id)}
        mayDelete={isOwner}
        calls={calls.length}
      />

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
