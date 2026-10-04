import { recordFailure } from '@tesserafy/ai';
import { NextResponse, type NextRequest } from 'next/server';
import { crmKeyAvailable, logCallToCrm } from '@/lib/crm';
import { allowance, tooMany } from '@/lib/rate-limit';
import { siteUrl } from '@/lib/site-url';
import { caller } from '@/lib/supabase/caller';

/**
 * POST /api/conversations/:id/crm — log the call to the company's CRM, as a
 * note on the customer's record (ADR 0024). Logging again rewrites the same
 * note. No AI is called, so no allowance is spent; rate limited because each
 * one is several requests to the company's CRM, on its own API limits.
 */
export const runtime = 'nodejs';

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const who = await caller(request);
  if (!who) return NextResponse.json({ error: 'not signed in' }, { status: 401 });
  if (!crmKeyAvailable()) {
    return NextResponse.json({ error: 'CRM sync is not switched on for this deployment yet.' }, { status: 503 });
  }
  const limit = await allowance(who.db, 'api/crm');
  if (!limit.allowed) return tooMany('api/crm', limit.retryAfterSeconds);

  const { id } = await params;
  try {
    const outcome = await logCallToCrm(who.db, id, siteUrl(request, `/conversations/${id}`).toString());
    switch (outcome.status) {
      case 'logged':
        return NextResponse.json({ companyName: outcome.companyName, url: outcome.url, updated: outcome.updated });
      case 'not_connected':
        return NextResponse.json({ error: 'No CRM is connected. An owner connects one in Settings.' }, { status: 409 });
      case 'no_customer':
        return NextResponse.json(
          { error: 'Set this call’s customer, with its web domain, so the note lands on the right record.' },
          { status: 422 },
        );
      case 'no_record':
        return NextResponse.json({ error: `HubSpot has no company with the domain ${outcome.domain}.` }, { status: 422 });
      case 'refused':
        return NextResponse.json(
          { error: 'HubSpot refused the connection. An owner reconnects it in Settings.' },
          { status: 502 },
        );
    }
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === '42501') {
      return NextResponse.json({ error: 'A support session does not write to the customer’s CRM.' }, { status: 403 });
    }
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P0002') {
      return NextResponse.json({ error: 'That call was not found.' }, { status: 404 });
    }
    const failure = recordFailure(error, { db: who.db, source: 'api/conversations/crm', conversationId: id });
    return NextResponse.json({ error: failure.said }, { status: 502 });
  }
}
