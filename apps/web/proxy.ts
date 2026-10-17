import { NextResponse, type NextRequest } from 'next/server';
import { appRedirect } from './lib/hosts';
import { updateSession } from './lib/supabase/proxy';

export function proxy(request: NextRequest) {
  // The landing page's host serves the landing page; sign-in and everything
  // behind it are on the app's host (lib/hosts). Before the session check:
  // a landing-page visitor needs no round trip to the auth server.
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
  const elsewhere = appRedirect(request.nextUrl, host, process.env.NEXT_PUBLIC_APP_URL);
  if (elsewhere) return NextResponse.redirect(elsewhere);
  return updateSession(request);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|mp4|webm)$).*)'],
};
