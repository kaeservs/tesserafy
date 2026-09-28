import Link from 'next/link';
import { readAll } from '@tesserafy/db';
import { percent } from '@/lib/coaching';
import { loadCoachingCalls } from '@/lib/coaching-data';
import { engagementLabel } from '@/lib/company';
import { OUTCOME_LABEL } from '@/lib/outcome';
import { createClient } from '@/lib/supabase/server';
import { weeklySummary } from '@/lib/weekly';

export const metadata = { title: 'This week · Tesserafy' };

function day(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
}

function score(value: number | null): string {
  return value === null ? '—' : String(Math.round(value));
}

/**
 * Your week: your calls and how they scored, what colleagues noted on them,
 * insights waiting, and one thing to work on — the weekly email this product
 * will send once it can send email, readable meanwhile. The summary is built
 * by lib/weekly.ts, which the email will use as it is.
 */
export default async function WeekPage({ searchParams }: { searchParams: Promise<{ week?: string }> }) {
  const { week: asked } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const [calls, notes, insights, { data: team }] = await Promise.all([
    loadCoachingCalls(supabase),
    readAll<{ body: string; author: string | null; conversation_id: string; segment_id: string; created_at: string }>(
      (from, to) =>
        supabase
          .from('segment_notes')
          .select('body, author, conversation_id, segment_id, created_at')
          .gte('created_at', new Date(Date.now() - 120 * 86_400_000).toISOString())
          .order('id')
          .range(from, to),
      'Could not load notes',
    ),
    readAll<{ id: string; title: string; status: string; created_at: string; decided_at: string | null }>(
      (from, to) => supabase.from('insights').select('id, title, status, created_at, decided_at').order('id').range(from, to),
      'Could not load insights',
    ),
    supabase.rpc('company_team'),
  ]);

  const addedBy = new Map(calls.map((call) => [call.id, call.addedBy]));
  const titleOf = new Map(calls.map((call) => [call.id, call.title]));
  const nameOf = new Map((team ?? []).map((person) => [person.user_id, person.email]));
  const summary = weeklySummary({
    userId: user?.id ?? '',
    calls,
    notes: notes.map((note) => ({
      body: note.body,
      author: note.author,
      conversationId: note.conversation_id,
      segmentId: note.segment_id,
      at: note.created_at,
      conversationAddedBy: addedBy.get(note.conversation_id) ?? null,
    })),
    insights: insights.map((insight) => ({
      id: insight.id,
      title: insight.title,
      status: insight.status,
      createdAt: insight.created_at,
      decidedAt: insight.decided_at,
    })),
    now: new Date(),
    week: asked ?? null,
  });
  const { mine } = summary;
  const change =
    mine.average !== null && mine.previousAverage !== null ? Math.round(mine.average - mine.previousAverage) : null;

  return (
    <main>
      <h1>{summary.nextWeek ? `The week of ${day(summary.week)}` : 'This week'}</h1>
      <p className="toolbar muted">
        <Link href={`/week?week=${summary.previousWeek}`}>← The week before</Link>
        {summary.nextWeek ? <Link href={`/week?week=${summary.nextWeek}`}>The week after →</Link> : null}
        <span>Monday to Sunday, UTC.</span>
      </p>

      <div className="grid" style={{ marginTop: '1rem' }}>
        <div className="card">
          <span className="stat-value">{mine.calls.length}</span>
          <span className="stat-label">
            call{mine.calls.length === 1 ? '' : 's'} you added
            {mine.won + mine.lost > 0 ? ` · ${mine.won} won, ${mine.lost} lost` : ''}
          </span>
        </div>
        <div className="card">
          <span className="stat-value">{score(mine.average)}</span>
          <span className="stat-label">
            your average
            {change !== null ? ` · ${change > 0 ? '↑' : change < 0 ? '↓' : '→'} ${Math.abs(change)} on the week before` : ''}
          </span>
        </div>
        <div className="card">
          <span className="stat-value">{summary.company.calls}</span>
          <span className="stat-label">calls across the company · average {score(summary.company.average)}</span>
        </div>
      </div>

      {summary.focus || summary.winning ? (
        <section aria-labelledby="focus-heading" className="card" style={{ marginTop: '1rem' }}>
          <h2 id="focus-heading" style={{ marginTop: 0 }}>
            One thing to work on
          </h2>
          {summary.focus ? (
            <p>
              <strong>{summary.focus.label}</strong>: met on {percent(summary.focus.rate)} of your scored calls over the
              last eight weeks, against {percent(summary.focus.companyRate)} across the company.
            </p>
          ) : null}
          {summary.winning ? (
            <p className="muted" style={{ marginBottom: 0 }}>
              Across the company, <strong>{summary.winning.label}</strong> is met on {percent(summary.winning.wonRate)} of
              won calls and {percent(summary.winning.lostRate)} of lost ones.{' '}
              <Link href="/reports">What goes with a win →</Link>
            </p>
          ) : null}
        </section>
      ) : null}

      <section aria-labelledby="calls-heading">
        <h2 id="calls-heading">Your calls</h2>
        {mine.calls.length === 0 ? (
          <p className="muted">None this week.</p>
        ) : (
          <ul className="meetings">
            {mine.calls.map((call) => (
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

      <section aria-labelledby="notes-heading">
        <h2 id="notes-heading">Notes on your calls</h2>
        {summary.notesOnMine.length === 0 ? (
          <p className="muted">None this week.</p>
        ) : (
          <ul className="evidence">
            {summary.notesOnMine.map((note, index) => (
              <li key={`${note.segmentId}-${index}`}>
                <Link href={`/conversations/${note.conversationId}#segment-${note.segmentId}`}>{note.body}</Link>{' '}
                <span className="muted">
                  — {note.author ? (nameOf.get(note.author) ?? 'a former member') : 'a former member'}, on{' '}
                  {titleOf.get(note.conversationId) ?? 'a call'}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="insights-heading">
        <h2 id="insights-heading">Insights</h2>
        {summary.insightsWaiting.length === 0 && summary.insightsApproved.length === 0 ? (
          <p className="muted">Nothing waiting, and nothing approved this week.</p>
        ) : (
          <ul className="evidence">
            {summary.insightsWaiting.map((insight) => (
              <li key={insight.id}>
                <span className="stage stage-proposed">waiting</span> <Link href={`/insights/${insight.id}`}>{insight.title}</Link>
              </li>
            ))}
            {summary.insightsApproved.map((insight) => (
              <li key={insight.id}>
                <span className="stage stage-approved">approved</span> <Link href={`/insights/${insight.id}`}>{insight.title}</Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
