import { NextResponse, type NextRequest } from 'next/server';
import { ticketBody, ticketTitle, type TicketCitation } from '@/lib/ticket';
import { siteUrl } from '@/lib/site-url';
import { createClient } from '@/lib/supabase/server';

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
 */
export const runtime = 'nodejs';

interface SignalRow {
  id: string;
  conversation_id: string;
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'not signed in' }, { status: 401 });
  }

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
  supabase: Awaited<ReturnType<typeof createClient>>,
  insightId: string,
): Promise<TicketCitation[]> {
  const { data: cited } = await supabase
    .from('insight_evidence')
    .select('signal_id')
    .eq('insight_id', insightId);

  const signalIds = ((cited ?? []) as { signal_id: string }[]).map((row) => row.signal_id);
  if (signalIds.length === 0) return [];

  const [signalsResult, evidenceResult] = await Promise.all([
    supabase.from('signals').select('id, conversation_id').in('id', signalIds),
    supabase.from('signal_evidence').select('signal_id, segment_id, quote').in('signal_id', signalIds),
  ]);

  const signals = new Map(
    ((signalsResult.data ?? []) as SignalRow[]).map((row) => [row.id, row.conversation_id]),
  );
  const evidence = (evidenceResult.data ?? []) as {
    signal_id: string;
    segment_id: string;
    quote: string;
  }[];

  const [conversationsResult, segmentsResult] = await Promise.all([
    supabase.from('conversations').select('id, title').in('id', [...new Set(signals.values())]),
    supabase
      .from('segments')
      .select('id, start_ms, speaker')
      .in('id', [...new Set(evidence.map((row) => row.segment_id))]),
  ]);

  const conversations = new Map(
    ((conversationsResult.data ?? []) as { id: string; title: string }[]).map((row) => [
      row.id,
      row.title,
    ]),
  );
  const segments = new Map(
    ((segmentsResult.data ?? []) as { id: string; start_ms: number; speaker: string | null }[]).map(
      (row) => [row.id, row],
    ),
  );

  return evidence.flatMap((row) => {
    const conversationId = signals.get(row.signal_id);
    const segment = segments.get(row.segment_id);
    if (!conversationId || !segment) return [];

    return [
      {
        quote: row.quote,
        conversationTitle: conversations.get(conversationId) ?? 'Unknown conversation',
        conversationId,
        segmentId: row.segment_id,
        startMs: segment.start_ms,
        speaker: segment.speaker,
      },
    ];
  });
}
