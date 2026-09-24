import { recordFailure } from '@tesserafy/ai';
import { NextResponse, type NextRequest } from 'next/server';
import { extractConversation } from '@/lib/extract-conversation';
import { allowance, tooMany } from '@/lib/rate-limit';
import { caller } from '@/lib/supabase/caller';

/**
 * "Find insights in this call."
 *
 * Synchronous on purpose, unlike scoring. Scoring is something that happens to
 * an upload; this is something a person asked for and is waiting on, so the
 * answer — how many signals, or that there were none — comes back in the
 * response rather than appearing later from nowhere. An hour-long call is a
 * single Opus request, well inside the budget below.
 *
 * See lib/extract-conversation.ts for why this runs only when asked, and runs
 * as the customer.
 */
export const runtime = 'nodejs';
export const maxDuration = 300;

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const who = await caller(request);
  if (!who) return NextResponse.json({ error: 'not signed in' }, { status: 401 });

  if (!process.env['ANTHROPIC_API_KEY']) {
    return NextResponse.json({ error: 'Extraction is not configured on this deployment.' }, { status: 503 });
  }

  const limit = await allowance(who.db, 'api/extract');
  if (!limit.allowed) return tooMany('api/extract', limit.retryAfterSeconds);

  const { id } = await params;
  try {
    const outcome = await extractConversation(who.db, id);
    switch (outcome.status) {
      case 'already_extracted':
        return NextResponse.json({ error: 'This call has already been read for insights.' }, { status: 409 });
      case 'too_long':
        return NextResponse.json(
          { error: 'This call is longer than the product reads automatically.' },
          { status: 422 },
        );
      case 'nothing_to_extract':
        return NextResponse.json({ error: 'This call has no transcript to read.' }, { status: 422 });
      case 'extracted':
        return NextResponse.json({ recorded: outcome.recorded, rejected: outcome.rejected });
    }
  } catch (error) {
    const failure = recordFailure(error, {
      db: who.db,
      source: 'api/conversations/extract',
      tier: 't3',
      conversationId: id,
    });
    return NextResponse.json({ error: failure.message }, { status: 502 });
  }
}
