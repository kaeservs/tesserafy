import { recordFailure } from '@tesserafy/ai';
import { timingSafeEqual } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { CalendarRefused, calendarAvailable, exchangeCode, isCalendarProvider } from '@/lib/calendar';
import { calendarBox, syncCalendars } from '@/lib/calendar-sync';
import { siteUrl } from '@/lib/site-url';
import { caller } from '@/lib/supabase/caller';

/**
 * GET /api/calendar/callback/:provider — Google or Microsoft sends the person
 * back here with a code. Only a return carrying the state this browser was
 * given is accepted; the code is traded for a refresh token, which is sealed
 * to this person before it is stored, and the first sync runs at once so the
 * meetings are there when the page loads.
 */
export const runtime = 'nodejs';

const STATE_COOKIE = 'tesserafy_calendar_state';

function same(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  const back = (outcome: string) => {
    const response = NextResponse.redirect(siteUrl(request, `/account?calendar=${outcome}#calendar-heading`));
    response.cookies.delete({ name: STATE_COOKIE, path: '/api/calendar' });
    return response;
  };

  const who = await caller(request);
  if (!who) return NextResponse.redirect(siteUrl(request, '/login'));
  if (!isCalendarProvider(provider) || !calendarAvailable(provider)) return back('unavailable');

  const url = request.nextUrl;
  // The person said no, or closed the window.
  if (url.searchParams.get('error')) return back('declined');
  const code = url.searchParams.get('code') ?? '';
  const state = url.searchParams.get('state') ?? '';
  const expected = request.cookies.get(STATE_COOKIE)?.value ?? '';
  if (!code || !state || !same(expected, `${provider}:${state}`)) return back('expired');

  try {
    const redirectUri = siteUrl(request, `/api/calendar/callback/${provider}`).toString();
    const { refreshToken, email } = await exchangeCode(provider, code, redirectUri);
    const { error } = await who.db.rpc('connect_calendar', {
      p_provider: provider,
      p_account_email: email,
      p_token_ciphertext: calendarBox.seal(refreshToken, who.userId),
    });
    if (error) throw new Error(`connecting the calendar failed: ${error.message}`, { cause: error });
    await syncCalendars(who.db, who.userId, { force: true });
    return back('connected');
  } catch (cause) {
    if (!(cause instanceof CalendarRefused)) recordFailure(cause, { db: who.db, source: 'calendar/connect' });
    return back('failed');
  }
}
