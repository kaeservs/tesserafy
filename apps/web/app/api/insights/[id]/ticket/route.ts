import type { SupabaseClient } from '@tesserafy/db';
import { NextResponse, type NextRequest } from 'next/server';
import { ticketBody, ticketTitle, type TicketCitation } from '@/lib/ticket';
import { siteUrl } from '@/lib/site-url';
import { caller } from '@/lib/supabase/caller';

/**
 * Create a ticket from an approved insight.
 *
 * Nothing here runs on its own. The route is a POST a person makes from the
 * insight page, it refuses an insight that is not approved, and the database
 * refuses to record a ticket for one — the gate's "no auto-creation anywhere"
 * is enforced in both places on purpose, because the cheap place to forget it
 * is here and the expensive place to discover that is a customer's tracker.
 *
 * The citations are read back from the insight's own chain rather than taken
 * from the request. A caller cannot put words in a ticket that no detector
 * verified.
 *
 * It is also idempotent, and that ordering is the point. `insight_tickets` has
 * a unique (insight_id, provider) so a second ticket cannot be *recorded* —
 * but checking only there means the duplicate issue has already been opened in
 * someone else's tracker by the time the constraint fires, and all the
 * constraint buys is a 500 for something that already happened. Two tabs, a
 * refresh, or a retry after a timeout are enough. So the existing ticket is
 * looked up before GitHub is called, and returned as the answer.
 */
export const runtime = 'nodejs';

interface SignalRow {
  id: string;
  conversation_id: string;
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const who = await caller(request);
  if (!who) {
    return NextResponse.json({ error: 'not signed in' }, { status: 401 });
  }
  const supabase = who.db;

  const token = process.env['GITHUB_TOKEN'];
  const repo = process.env['GITHUB_TICKET_REPO'];
  if (!token || !repo) {
    return NextResponse.json(
      { error: 'GITHUB_TOKEN and GITHUB_TICKET_REPO are not set' },
      { status: 503 },
    );
  }

  // RLS decides visibility; another tenant's insight is simply not found.
  const { data: insight } = await supabase
    .from('insights')
    .select('id, title, summary, status')
    .eq('id', id)
    .maybeSingle();

  if (!insight) {
    return NextResponse.json({ error: 'insight not found' }, { status: 404 });
  }

  const { title, summary, status } = insight as {
    title: string;
    summary: string;
    status: string;
  };

  // Before GitHub, not after. The already-raised answer is a success: whoever
  // clicked wanted a ticket for this insight, and there is one.
  const { data: existing } = await supabase
    .from('insight_tickets')
    .select('url, external_id')
    .eq('insight_id', id)
    .eq('provider', 'github')
    .maybeSingle();

  if (existing) {
    const ticket = existing as { url: string; external_id: string };
    return NextResponse.json({
      url: ticket.url,
      number: Number(ticket.external_id),
      alreadyRaised: true,
    });
  }

  if (status !== 'approved') {
    return NextResponse.json(
      { error: `insight is ${status}; approve it before raising a ticket` },
      { status: 409 },
    );
  }

  const citations = await loadCitations(supabase, id);
  if (citations.length === 0) {
    return NextResponse.json({ error: 'insight has no evidence' }, { status: 409 });
  }

  const insightUrl = siteUrl(request, `/insights/${id}`).toString();
  const created = await fetch(`https://api.github.com/repos/${repo}/issues`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/vnd.github+json',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      title: ticketTitle({ title, summary, citations, insightUrl }),
      body: ticketBody({ title, summary, citations, insightUrl }),
    }),
  });

  if (!created.ok) {
    return NextResponse.json(
      { error: `creating the issue failed: ${created.status} ${await created.text()}` },
      { status: 502 },
    );
  }

  const issue = (await created.json()) as { number: number; html_url: string };

  // Recorded through a function that re-checks approval, so a ticket cannot be
  // attributed to an insight nobody agreed to.
  const { error: recordError } = await supabase.rpc('record_insight_ticket', {
    p_insight_id: id,
    p_provider: 'github',
    p_external_id: String(issue.number),
    p_url: issue.html_url,
  });

  if (recordError) {
    // A unique violation here means two requests raced past the check above.
    // The duplicate issue is already open — nothing can undo that from here —
    // but the answer should still be the ticket this insight actually has,
    // not an error that invites a third click.
    if (recordError.code === '23505') {
      const { data: winner } = await supabase
        .from('insight_tickets')
        .select('url, external_id')
        .eq('insight_id', id)
        .eq('provider', 'github')
        .maybeSingle();

      if (winner) {
        const ticket = winner as { url: string; external_id: string };
        return NextResponse.json({
          url: ticket.url,
          number: Number(ticket.external_id),
          alreadyRaised: true,
          duplicate: issue.html_url,
        });
      }
    }

    // The issue exists and we failed to remember it. Say so plainly: a silent
    // failure here means the next click opens a second issue.
    return NextResponse.json(
      {
        error: `the issue was created at ${issue.html_url} but could not be recorded: ${recordError.message}`,
        url: issue.html_url,
      },
      { status: 500 },
    );
  }

  return NextResponse.json({ url: issue.html_url, number: issue.number });
}

async function loadCitations(
  supabase: SupabaseClient,
  insightId: string,
): Promise<TicketCitation[]> {
  const { data: cited } = await supabase
    .from('insight_evidence')
    .select('signal_id')
    .eq('insight_id', insightId);

  const signalIds = ((cited ?? [])).map((row) => row.signal_id);
  if (signalIds.length === 0) return [];

  const [signalsResult, evidenceResult] = await Promise.all([
    supabase.from('signals').select('id, conversation_id').in('id', signalIds),
    supabase.from('signal_evidence').select('signal_id, segment_id, quote').in('signal_id', signalIds),
  ]);

  const signals = new Map(
    ((signalsResult.data ?? []) as SignalRow[]).map((row) => [row.id, row.conversation_id]),
  );
  const evidence = (evidenceResult.data ?? []);

  // Neither the conversation title nor the speaker is read, because neither is
  // sent: see the header of lib/ticket.ts. Not selecting them is the cheaper
  // guarantee — a column that was never loaded cannot be appended to a body by
  // a later change that forgets why.
  const { data: segmentRows } = await supabase
    .from('segments')
    .select('id, start_ms')
    .in('id', [...new Set(evidence.map((row) => row.segment_id))]);

  const segments = new Map(
    ((segmentRows ?? [])).map((row) => [row.id, row]),
  );

  return evidence.flatMap((row) => {
    const conversationId = signals.get(row.signal_id);
    const segment = segments.get(row.segment_id);
    if (!conversationId || !segment) return [];

    return [
      {
        quote: row.quote,
        conversationId,
        segmentId: row.segment_id,
        startMs: segment.start_ms,
      },
    ];
  });
}
