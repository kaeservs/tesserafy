import Link from 'next/link';
import { notFound } from 'next/navigation';
import { followUpText } from '@tesserafy/ai';
import { FollowUp } from '@/components/follow-up';
import { emailAvailable, sendingAddress } from '@/lib/email';
import { clock } from '@/lib/highlight';
import { createClient } from '@/lib/supabase/server';

export const metadata = { title: 'Follow-up email · Tesserafy' };

function stamp(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }) + ' UTC';
}

/**
 * A call's follow-up email, on its own page: drafted when asked (one read of
 * the call, charged like action items), every line of the recap and the next
 * steps quoting the call, and sent from here through Resend when it is set up
 * (ADR 0023). Its own path, so the call page, Home and the overlay — which
 * offers it when a call ends — all link to it rather than to a part of the
 * call's page.
 *
 * It shows the call's words, so opening it is recorded in the call's access
 * trail first, as opening the call is: a failure to record is a failure to open.
 */
export default async function FollowUpPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const [{ data: conversation }, { error: unrecorded }, { data: auth }] = await Promise.all([
    supabase.from('conversations').select('id, title').eq('id', id).maybeSingle(),
    supabase.rpc('record_conversation_view', { p_conversation_id: id }),
    supabase.auth.getUser(),
  ]);
  if (!conversation) notFound();
  if (unrecorded) throw new Error(`Could not record opening this call: ${unrecorded.message}`);
  const user = auth.user;

  const [{ data: followUpRow }, { data: sendRows }, { data: attendeeRows }, { data: preferences }] = await Promise.all([
    supabase
      .from('follow_ups')
      .select('id, subject, greeting, opening, closing, created_at, follow_up_lines(position, kind, text, segment_id, quote)')
      .eq('conversation_id', id)
      .maybeSingle(),
    supabase
      .from('follow_up_sends')
      .select('recipients, status, created_at, sent_by')
      .eq('conversation_id', id)
      .order('created_at', { ascending: false })
      .limit(10),
    // Who from outside was invited, from the caller's calendar (ADR 0026): where the To starts.
    supabase.from('call_attendees').select('email').eq('conversation_id', id).order('email'),
    // The name on the person's profile, for the follow-up's sender.
    supabase.from('user_preferences').select('display_name').eq('user_id', user?.id ?? '').maybeSingle(),
  ]);

  const lines = [...(followUpRow?.follow_up_lines ?? [])]
    .sort((a, b) => a.position - b.position)
    .map((line) => ({
      kind: line.kind === 'next_step' ? ('next_step' as const) : ('recap' as const),
      text: line.text,
      segmentId: line.segment_id,
      quote: line.quote,
    }));
  // When in the call each quoted line was said, for the time beside it.
  const { data: quoted } = lines.length
    ? await supabase
        .from('segments')
        .select('id, start_ms')
        .in(
          'id',
          lines.map((line) => line.segmentId),
        )
    : { data: [] };
  const startedAt = new Map((quoted ?? []).map((segment) => [segment.id, segment.start_ms]));

  const draft = followUpRow
    ? {
        subject: followUpRow.subject,
        text: followUpText({ ...followUpRow, lines }),
        drafted: stamp(followUpRow.created_at),
        lines: lines.map((line) => ({ ...line, at: clock(startedAt.get(line.segmentId) ?? 0) })),
      }
    : null;
  const sends = (sendRows ?? []).map((row) => ({
    recipients: row.recipients,
    when: stamp(row.created_at),
    byYou: row.sent_by === user?.id,
    status: row.status === 'sent' ? ('sent' as const) : row.status === 'failed' ? ('failed' as const) : ('sending' as const),
  }));
  const from = emailAvailable() ? sendingAddress() : null;

  return (
    <main>
      <p>
        <Link href={`/conversations/${id}`}>← {conversation.title}</Link>
      </p>
      <h1>Follow-up email</h1>
      <p className="muted">
        For “{conversation.title}”. Every line of the recap and the next steps quotes the call, and it promises nothing the
        call did not say — it goes out in your name.
      </p>
      <FollowUp
        conversationId={id}
        draft={draft}
        sending={from ? { from } : null}
        sends={sends}
        attendees={(attendeeRows ?? []).map((attendee) => attendee.email)}
        senderName={preferences?.display_name ?? ''}
      />
    </main>
  );
}
