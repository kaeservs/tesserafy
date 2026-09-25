import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { publicSupabaseEnv } from '../env';
import { siteUrl } from '../site-url';

const PUBLIC_PATHS = ['/login', '/signup', '/auth/'];

/**
 * Refreshes the auth session cookie and turns signed-out visitors away from
 * everything except the login flow.
 *
 * The redirect has to happen here, not only in a layout: Next renders layouts
 * and pages in parallel, so a page behind a layout-only check still runs.
 */
export async function updateSession(request: NextRequest): Promise<NextResponse> {
  const { url, publishableKey } = publicSupabaseEnv();
  let response = NextResponse.next({ request });

  const supabase = createServerClient(url, publishableKey, {
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

  const { pathname } = request.nextUrl;
  const isPublic = pathname === '/' || PUBLIC_PATHS.some((p) => pathname.startsWith(p));

  // API routes answer for themselves. Redirecting one to /login gives a
  // programmatic caller a 307 and an HTML page where it expected JSON, and it
  // makes bearer-token auth impossible — this proxy only reads cookies, so it
  // would turn away a caller holding a perfectly good token before the route
  // ever saw the header. Every route under /api must therefore authenticate;
  // an unauthenticated one without a token still gets 401 from here.
  if (pathname.startsWith('/api/')) {
    if (!user && !request.headers.get('authorization')) {
      return NextResponse.json({ error: 'not signed in' }, { status: 401 });
    }
    return response;
  }

  if (!user && !isPublic) {
    const redirect = NextResponse.redirect(siteUrl(request, '/login'));
    // Keep any refreshed or cleared auth cookies on the redirect.
    for (const cookie of response.cookies.getAll()) {
      redirect.cookies.set(cookie);
    }
    return redirect;
  }

  return response;
}
