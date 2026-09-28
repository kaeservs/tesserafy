import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';

export const metadata = { title: 'Notifications · Tesserafy' };

interface Row {
  id: string;
  kind: string;
  created_at: string;
  read_at: string | null;
  actor: string | null;
  insight_id: string | null;
  conversation_id: string | null;
  insights: { title: string } | null;
  conversations: { title: string } | null;
  segment_notes: { body: string; segment_id: string } | null;
  access_requests: { email: string; resolution: string | null; resolution_note: string | null } | null;
}

function when(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }) + ' UTC';
}

function excerpt(text: string, length = 140): string {
  return text.length > length ? `${text.slice(0, length)}…` : text;
}

/**
 * What happened that concerns you: insights waiting, notes on your calls,
 * answers to your requests.
 *
 * Titles and notes are read now, not stored with the notification, so a
 * renamed call shows its new name and an erased one takes its notification
 * with it (see the notifications migration). Opening the page marks what it
 * shows as read; what was new is still marked as new on this visit.
 */
export default async function NotificationsPage() {
  const supabase = await createClient();
  const [{ data, error }, { data: team }] = await Promise.all([
    supabase
      .from('notifications')
      .select(
        'id, kind, created_at, read_at, actor, insight_id, conversation_id, insights(title), conversations(title), segment_notes(body, segment_id), access_requests(email, resolution, resolution_note)',
      )
      .order('created_at', { ascending: false })
      .limit(100),
    supabase.rpc('company_team'),
  ]);
  if (error) throw new Error(`Could not load notifications: ${error.message}`);
  const rows = (data ?? []) as unknown as Row[];
  // Read first, then marked: this render still shows which were new.
  if (rows.some((row) => row.read_at === null)) await supabase.rpc('mark_notifications_read', {});

  const nameOf = new Map((team ?? []).map((person) => [person.user_id, person.email]));
  const who = (id: string | null, nobody: string) => (id ? (nameOf.get(id) ?? 'a former member') : nobody);

  return (
    <main>
      <h1>Notifications</h1>
      <p className="muted">
        Insights waiting for you, notes colleagues leave on your calls, and answers to your requests. There
        is no email yet, so this is where they arrive.
      </p>
      {rows.length === 0 ? (
        <p className="muted">Nothing yet.</p>
      ) : (
        <ul className="signals">
          {rows.map((row) => (
            <li key={row.id} className={`signal${row.read_at === null ? ' unread' : ''}`}>
              <div>
                {row.read_at === null ? <span className="stage stage-proposed">new</span> : null}{' '}
                {row.kind === 'insight_assigned' && row.insights ? (
                  <>
                    {who(row.actor, 'Someone')} gave you an insight to own:{' '}
                    <Link href={`/insights/${row.insight_id}`}>{row.insights.title}</Link>
                  </>
                ) : null}
                {row.kind === 'insight_proposed' && row.insights ? (
                  <>
                    A new insight is waiting for you:{' '}
                    <Link href={`/insights/${row.insight_id}`}>{row.insights.title}</Link>
                    <span className="muted"> — found {who(row.actor, 'by Tesserafy')}</span>
                  </>
                ) : null}
                {row.kind === 'note_on_your_call' && row.segment_notes && row.conversations ? (
                  <>
                    {who(row.actor, 'Someone')} noted a moment on{' '}
                    <Link href={`/conversations/${row.conversation_id}#segment-${row.segment_notes.segment_id}`}>
                      {row.conversations.title}
                    </Link>
                    : <q>{excerpt(row.segment_notes.body)}</q>
                  </>
                ) : null}
                {row.kind === 'request_answered' && row.access_requests ? (
                  <>
                    Your request to add {row.access_requests.email} was{' '}
                    {row.access_requests.resolution === 'added' ? 'approved — they can sign in now' : 'declined'}
                    {row.access_requests.resolution_note ? `: “${row.access_requests.resolution_note}”` : ''}.{' '}
                    <Link href="/settings">Team</Link>
                  </>
                ) : null}
              </div>
              <p className="muted" style={{ fontSize: '0.8rem', margin: '0.25rem 0 0' }}>
                {when(row.created_at)}
              </p>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
