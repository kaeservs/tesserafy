import { NextResponse, type NextRequest } from 'next/server';
import { caller } from '@/lib/supabase/caller';

/**
 * Start recording a live call.
 *
 * A conversation is created up front rather than at the end, so a call that
 * ends in a crashed tab or a sleeping laptop is still a call that happened.
 * A meeting cannot be re-run; losing forty minutes of it to a browser is not
 * a recoverable failure.
 *
 * The insert goes through start_live_conversation(), a SECURITY DEFINER
 * function, because conversations are read-only to a signed-in user and
 * giving a browser insert rights here would also give it insert rights on
 * criterion_events through PostgREST — where it could supply its own quote
 * offsets, which is the one thing the evidence rule forbids.
 */
export const runtime = 'nodejs';

interface StartBody {
  title?: string;
  engagementType?: string;
  criteriaVersion?: number;
  companyId?: string;
}

export async function POST(request: NextRequest) {
  const who = await caller(request);
  if (!who) {
    return NextResponse.json({ error: 'not signed in' }, { status: 401 });
  }

  let body: StartBody;
  try {
    body = (await request.json()) as StartBody;
  } catch {
    return NextResponse.json({ error: 'body must be JSON' }, { status: 400 });
  }

  const title = (body.title ?? '').trim();
  if (title.length === 0) {
    return NextResponse.json({ error: 'a title is required' }, { status: 400 });
  }

  const { data, error } = await who.db.rpc('start_live_conversation', {
    p_title: title,
    p_engagement_type: body.engagementType ?? 'discovery',
    p_criteria_version: body.criteriaVersion ?? 1,
    // Omitted when the caller did not name a company: the function then
    // resolves the one company they belong to, and raises 22023 if there is
    // more than one. Sending null says the same thing; leaving it out is what
    // the generated types describe.
    ...(body.companyId ? { p_company_id: body.companyId } : {}),
  });

  if (error) {
    // 22023 is "you are in more than one company, say which" — a request
    // problem the caller can fix, not a server fault.
    const status = error.code === '42501' ? 403 : error.code === '22023' ? 400 : 502;
    return NextResponse.json({ error: error.message }, { status });
  }

  return NextResponse.json({ conversationId: data });
}
