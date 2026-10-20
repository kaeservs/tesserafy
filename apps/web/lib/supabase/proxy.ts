import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { publicSupabaseEnv } from '../env';
import { fromAnotherHost, isAppHost } from '../hosts';
import { siteUrl } from '../site-url';
import { SESSION_COOKIE } from './cookies';

const PUBLIC_PATHS = ['/login', '/signup', '/auth/', '/terms', '/privacy'];

/**
 * API routes whose caller is never signed in, because they are not a person:
 * Stripe's webhook proves itself by its signature, which the database checks
 * before reading anything (ADR 0025). Exact paths, never prefixes. Not a page
 * either, so the Origin check below is not theirs.
 */
const SIGNED_API_PATHS = new Set(['/api/stripe/webhook']);

/** The methods that change something, which a page on another host must not send with a visitor's cookies. */
const WRITES = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Writes outside /api/ that are route handlers, which have no Origin check
 * of their own (a server action has Next's). Signing out is one: a sibling's
 * page could otherwise sign a visitor out.
 */
const OTHER_WRITES = new Set(['/auth/sign-out']);

/**
 * Refreshes the auth session cookie and turns signed-out visitors away from
 * everything except the login flow.
 *
 * The redirect has to happen here, not only in a layout: Next renders layouts
 * and pages in parallel, so a page behind a layout-only check still runs.
 */
export async function updateSession(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host');

  // SameSite=Lax keeps the session cookie off a POST from another site, but
  // every host under tesserafy.com is the same site: a page on n8n's, or on
  // any sibling, could post to the API as whoever visits it. The Origin says
  // which page sent a request, so one from another host is refused here,
  // before the auth server is asked anything. A request with no Origin is let
  // through (lib/hosts): the overlay calls from its main process without one.
  if (
    (pathname.startsWith('/api/') || OTHER_WRITES.has(pathname)) &&
    WRITES.has(request.method) &&
    !SIGNED_API_PATHS.has(pathname) &&
    fromAnotherHost(request.headers.get('origin'), host ?? request.nextUrl.host)
  ) {
    return NextResponse.json({ error: 'sent from another site' }, { status: 403 });
  }

  const { url, publishableKey } = publicSupabaseEnv();
  let response = NextResponse.next({ request });

  const supabase = createServerClient(url, publishableKey, {
    cookieOptions: SESSION_COOKIE,
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  // Validates the token with the auth server and rotates it if needed. Do not
  // put code between client creation and this call.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isPublic = pathname === '/' || PUBLIC_PATHS.some((p) => pathname.startsWith(p));

  // API routes answer for themselves. Redirecting one to /login gives a
  // programmatic caller a 307 and an HTML page where it expected JSON, and it
  // makes bearer-token auth impossible — this proxy only reads cookies, so it
  // would turn away a caller holding a perfectly good token before the route
  // ever saw the header. Every route under /api must therefore authenticate;
  // an unauthenticated one without a token still gets 401 from here.
  if (pathname.startsWith('/api/')) {
    if (!user && !request.headers.get('authorization') && !SIGNED_API_PATHS.has(pathname)) {
      return NextResponse.json({ error: 'not signed in' }, { status: 401 });
    }
    return response;
  }

  // On the app's own host there is no landing page: `/` is the dashboard, or
  // signing in to it.
  const appRoot = pathname === '/' && isAppHost(host, process.env.NEXT_PUBLIC_APP_URL);

  if ((!user && !isPublic) || appRoot) {
    const redirect = NextResponse.redirect(siteUrl(request, user ? '/dashboard' : '/login'));
    // Keep any refreshed or cleared auth cookies on the redirect.
    for (const cookie of response.cookies.getAll()) {
      redirect.cookies.set(cookie);
    }
    return redirect;
  }

  return response;
}
