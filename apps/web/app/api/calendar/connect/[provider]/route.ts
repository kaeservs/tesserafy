import { randomBytes } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { authorizeUrl, calendarAvailable, isCalendarProvider } from '@/lib/calendar';
import { siteUrl } from '@/lib/site-url';
import { caller } from '@/lib/supabase/caller';

/**
 * GET /api/calendar/connect/:provider — send the signed-in person to Google or
 * Microsoft to let Tesserafy read their calendar (ADR 0021).
 *
 * A random state goes with them and into a short-lived cookie; the callback
 * accepts only a return that carries the same one, so a link someone else
 * made cannot attach their calendar to this account, or this calendar to
 * theirs.
 */
export const runtime = 'nodejs';

const STATE_COOKIE = 'tesserafy_calendar_state';

export async function GET(request: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  const who = await caller(request);
  if (!who) return NextResponse.redirect(siteUrl(request, '/login'));
  if (!isCalendarProvider(provider) || !calendarAvailable(provider)) {
    return NextResponse.redirect(siteUrl(request, '/account/calendar?calendar=unavailable'));
  }
  const state = randomBytes(24).toString('hex');
  const redirectUri = siteUrl(request, `/api/calendar/callback/${provider}`).toString();
  const response = NextResponse.redirect(authorizeUrl(provider, redirectUri, state));
  response.cookies.set(STATE_COOKIE, `${provider}:${state}`, {
    httpOnly: true,
    secure: redirectUri.startsWith('https://'),
    // Lax, not strict: the return from Google or Microsoft is a top-level navigation from their site.
    sameSite: 'lax',
    path: '/api/calendar',
    maxAge: 600,
  });
  return response;
}
