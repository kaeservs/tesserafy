import { NextResponse, type NextRequest } from 'next/server';
import { siteUrl } from '@/lib/site-url';
import { createClient } from '@/lib/supabase/server';

/**
 * Where a sign-in link lands.
 *
 * Three shapes arrive here, and the difference matters when one stops working:
 *
 *   ?code=…                 the PKCE flow, what signInWithOtp produces
 *   ?token_hash=…&type=…    the non-PKCE link shape, if the email template is
 *                           ever changed to send one
 *   ?error=…&error_code=…   Supabase declining, e.g. otp_expired
 *
 * The reason is carried through to the login page rather than flattened into
 * one message. "Already used" and "older than an hour" send a person to
 * different fixes, and whoever is debugging a failed sign-in needs the code
 * Supabase actually returned.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;

  const declined = params.get('error_code') ?? params.get('error');
  if (declined) {
    return NextResponse.redirect(siteUrl(request, `/login?error=${encodeURIComponent(declined)}`));
  }

  const supabase = await createClient();

  const code = params.get('code');
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(siteUrl(request, '/conversations'));
    }
    return NextResponse.redirect(
      siteUrl(request, `/login?error=${encodeURIComponent(error.code ?? 'exchange_failed')}`),
    );
  }

  const tokenHash = params.get('token_hash');
  const type = params.get('type');
  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({
      type: type as 'email' | 'magiclink' | 'recovery' | 'invite',
      token_hash: tokenHash,
    });
    if (!error) {
      return NextResponse.redirect(siteUrl(request, '/conversations'));
    }
    return NextResponse.redirect(
      siteUrl(request, `/login?error=${encodeURIComponent(error.code ?? 'verify_failed')}`),
    );
  }

  // No code, no token, no error: the link carried no credentials this side
  // could read. That is what an implicit-flow fallback looks like — the token
  // goes in the URL fragment, which a server never receives.
  return NextResponse.redirect(siteUrl(request, '/login?error=no_credentials'));
}
