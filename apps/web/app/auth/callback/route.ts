import { NextResponse, type NextRequest } from 'next/server';
import { siteUrl } from '@/lib/site-url';
import { createClient } from '@/lib/supabase/server';

/**
 * Where a sign-in link lands.
 *
 * Two shapes arrive here, and the difference matters when one stops working:
 *
 *   ?code=…                 the PKCE flow, what signInWithOtp produces
 *   ?error=…&error_code=…   Supabase declining, e.g. otp_expired
 *
 * A third, ?token_hash=…&type=…, was verified here too, for an email template
 * that might one day send one. Nothing does: sign-in and sign-up links, and
 * the console's, all go to /auth/confirm. And verifying one here signed the
 * browser in at once, over whoever was signed in, without saying as whom — a
 * link anyone can make for their own account would quietly sign a customer
 * into it. When email is ours and a token_hash link is wanted, it belongs on
 * /auth/confirm, which asks first.
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

  // No code and no error: the link carried no credentials this side could
  // read. That is what an implicit-flow fallback looks like — the token goes
  // in the URL fragment, which a server never receives.
  return NextResponse.redirect(siteUrl(request, '/login?error=no_credentials'));
}
