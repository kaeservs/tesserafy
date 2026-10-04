import { recordFailure } from '@tesserafy/ai';
import { NextResponse, type NextRequest } from 'next/server';
import { emailAvailable, isBody, isSenderName, isSubject, parseRecipients, sendEmail } from '@/lib/email';
import { allowance, tooMany } from '@/lib/rate-limit';
import { caller } from '@/lib/supabase/caller';

/**
 * POST /api/conversations/:id/follow-up/send — send the call's follow-up
 * email, as the seller edited it (ADR 0023).
 *
 * Recorded before it leaves, as the seller: begin_follow_up_send checks there
 * is a draft, the addresses, that this is not a support session, and the
 * company's hourly cap, and says where replies go. Then Resend, keyed by the
 * record so a retry cannot send twice; then the record is settled with what
 * Resend said. No AI is called here, so no allowance is spent.
 */
export const runtime = 'nodejs';

const REFUSED: Record<string, { status: number; error: string }> = {
  P0002: { status: 404, error: 'Draft the follow-up first.' },
  '42501': { status: 403, error: 'A support session does not send email in the customer’s name.' },
  '22023': { status: 400, error: 'Give one to ten email addresses.' },
  '23514': { status: 400, error: 'Check your name and the subject: no line breaks, quotes or angle brackets.' },
  '54000': { status: 429, error: 'Your company has sent thirty follow-ups this hour. Try again later.' },
};

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const who = await caller(request);
  if (!who) return NextResponse.json({ error: 'not signed in' }, { status: 401 });
  if (!emailAvailable()) {
    return NextResponse.json({ error: 'Sending email is not switched on for this deployment yet.' }, { status: 503 });
  }
  const limit = await allowance(who.db, 'api/follow-up/send');
  if (!limit.allowed) return tooMany('api/follow-up/send', limit.retryAfterSeconds);

  const input = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const to = parseRecipients(input?.['to']);
  if (!to) return NextResponse.json({ error: 'Give one to ten email addresses.' }, { status: 400 });
  const fromName = input?.['fromName'];
  const subject = input?.['subject'];
  const body = input?.['body'];
  if (!isSenderName(fromName)) return NextResponse.json({ error: 'Give your name as the sender, up to 100 characters.' }, { status: 400 });
  if (!isSubject(subject)) return NextResponse.json({ error: 'Give a subject of one line, up to 200 characters.' }, { status: 400 });
  if (!isBody(body)) return NextResponse.json({ error: 'The email is empty or too long.' }, { status: 400 });

  const { id } = await params;
  const { data: begun, error: refused } = await who.db.rpc('begin_follow_up_send', {
    p_conversation_id: id,
    p_from_name: fromName,
    p_recipients: to,
    p_subject: subject,
    p_body: body,
  });
  if (refused) {
    const known = REFUSED[refused.code];
    if (known) return NextResponse.json({ error: known.error }, { status: known.status });
    const failure = recordFailure(refused, { db: who.db, source: 'api/conversations/follow-up/send', conversationId: id });
    return NextResponse.json({ error: failure.said }, { status: 502 });
  }
  const send = begun as { id: string; reply_to: string; recipients: string[] };

  try {
    const sent = await sendEmail({ fromName, to: send.recipients, replyTo: send.reply_to, subject, text: body }, send.id);
    await who.db.rpc('finish_follow_up_send', { p_id: send.id, p_provider_id: sent.id });
    return NextResponse.json({ sent: send.recipients, copied: send.reply_to });
  } catch (error) {
    const failure = recordFailure(error, { db: who.db, source: 'api/conversations/follow-up/send', conversationId: id });
    await who.db.rpc('finish_follow_up_send', { p_id: send.id, p_error: failure.said });
    return NextResponse.json({ error: failure.said }, { status: 502 });
  }
}
