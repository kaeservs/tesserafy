import Link from 'next/link';
import { batches } from '@tesserafy/db';
import { CompleteCoaching } from '@/components/coaching-forms';
import { clock } from '@/lib/highlight';
import { createClient } from '@/lib/supabase/server';
import { withdrawCoaching } from './actions';

export const metadata = { title: 'Coaching · Tesserafy' };

interface AssignmentRow {
  id: string;
  assigned_to: string;
  assigned_by: string | null;
  conversation_id: string;
  segment_id: string | null;
  note: string | null;
  status: string;
  reply: string | null;
  done_at: string | null;
  created_at: string;
}

function day(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

/**
 * Coaching: calls and moments a manager asked someone to listen to. What is
 * yours first, open before done; an owner also sees everything assigned
 * across the team and whether it has been done. Nobody else sees any of it
 * (RLS: the seller, the assigner, owners).
 */
export default async function CoachingPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const [{ data: membership }, { data: team }, { data: rows }] = await Promise.all([
    supabase.from('company_members').select('role').eq('user_id', user?.id ?? '').limit(1).maybeSingle(),
    supabase.rpc('company_team'),
    supabase
      .from('coaching_assignments')
      .select('id, assigned_to, assigned_by, conversation_id, segment_id, note, status, reply, done_at, created_at')
      .order('created_at', { ascending: false })
      .limit(300)
      .returns<AssignmentRow[]>(),
  ]);
  const isOwner = membership?.role === 'owner';
  const assignments = rows ?? [];
  const nameOf = new Map((team ?? []).map((person) => [person.user_id, person.is_you ? 'you' : person.email]));

  const callIds = [...new Set(assignments.map((row) => row.conversation_id))];
  const segmentIds = [...new Set(assignments.flatMap((row) => (row.segment_id ? [row.segment_id] : [])))];
  const [calls, segments] = await Promise.all([
    Promise.all(batches(callIds).map(async (ids) => (await supabase.from('conversations').select('id, title').in('id', ids)).data ?? [])).then((p) => p.flat()),
    Promise.all(batches(segmentIds).map(async (ids) => (await supabase.from('segments').select('id, start_ms, speaker, text').in('id', ids)).data ?? [])).then((p) => p.flat()),
  ]);
  const titleOf = new Map(calls.map((call) => [call.id, call.title]));
  const segmentOf = new Map(segments.map((segment) => [segment.id, segment]));

  const mine = assignments
    .filter((row) => row.assigned_to === user?.id)
    .sort((a, b) => Number(a.status === 'done') - Number(b.status === 'done'));
  const team_ = isOwner ? assignments.filter((row) => row.assigned_to !== user?.id) : [];

  const item = (row: AssignmentRow, showWho: boolean) => {
    const segment = row.segment_id ? segmentOf.get(row.segment_id) : undefined;
    const href = `/conversations/${row.conversation_id}${row.segment_id ? `#segment-${row.segment_id}` : ''}`;
    return (
      <li key={row.id} className="signal">
        <div>
          <Link href={href}>
            {titleOf.get(row.conversation_id) ?? 'A call'}
            {segment ? `, at ${clock(segment.start_ms)}` : ''}
          </Link>{' '}
          <span className={`stage stage-${row.status === 'done' ? 'approved' : 'proposed'}`}>{row.status === 'done' ? 'done' : 'to listen'}</span>
        </div>
        {segment ? (
          <p className="muted" style={{ margin: '0.25rem 0' }}>
            {segment.speaker ?? 'Unnamed'}: “{segment.text.length > 180 ? `${segment.text.slice(0, 180)}…` : segment.text}”
          </p>
        ) : null}
        {row.note ? <p style={{ margin: '0.25rem 0' }}>{row.note}</p> : null}
        <p className="muted" style={{ fontSize: '0.82rem', margin: '0.25rem 0' }}>
          {showWho ? `For ${nameOf.get(row.assigned_to) ?? 'a former member'} · ` : ''}
          from {row.assigned_by ? (nameOf.get(row.assigned_by) ?? 'a former member') : 'a former member'}, {day(row.created_at)}
          {row.done_at ? ` · done ${day(row.done_at)}` : ''}
        </p>
        {row.reply ? <p style={{ margin: '0.25rem 0' }}>↳ {row.reply}</p> : null}
        {row.status !== 'done' && row.assigned_to === user?.id ? <CompleteCoaching assignmentId={row.id} /> : null}
        {isOwner || row.assigned_by === user?.id ? (
          <form action={withdrawCoaching} className="inline-form">
            <input type="hidden" name="assignmentId" value={row.id} />
            <button type="submit" className="link-button" style={{ fontSize: '0.8rem' }}>
              Withdraw
            </button>
          </form>
        ) : null}
      </li>
    );
  };

  return (
    <main>
      <h1>Coaching</h1>
      <p className="muted">
        Calls and moments to listen to, sent by a manager with a word on what to listen for. Owners send them from any call:
        open the call and choose <em>Assign for coaching</em>.
      </p>
      <section aria-labelledby="mine-heading">
        <h2 id="mine-heading">For you</h2>
        {mine.length === 0 ? <p className="muted">Nothing assigned to you.</p> : <ul className="signals">{mine.map((row) => item(row, false))}</ul>}
      </section>
      {isOwner ? (
        <section aria-labelledby="team-heading">
          <h2 id="team-heading">Assigned across the team</h2>
          {team_.length === 0 ? <p className="muted">Nothing assigned yet.</p> : <ul className="signals">{team_.map((row) => item(row, true))}</ul>}
        </section>
      ) : null}
    </main>
  );
}
