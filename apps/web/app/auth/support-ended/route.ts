import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * Where a support session goes when its window has closed (lib/support-session):
 * signed out here — a route, because only a route can clear the cookies — and
 * sent to sign in, told why. Local scope: this session, not the customer's
 * others.
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  await supabase.auth.signOut({ scope: 'local' });
  return NextResponse.redirect(new URL('/login?error=support_ended', request.url));
}
