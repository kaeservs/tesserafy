import { NextResponse, type NextRequest } from 'next/server';
import { siteUrl } from '@/lib/site-url';
import { createClient } from '@/lib/supabase/server';

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  // Local scope: this browser, not every session the account holds.
  //
  // Supabase signs out globally by default, and measured against this project
  // that is not a detail. An operator in a support session and the customer on
  // their own laptop are two sessions on one account; the operator finishing up
  // and clicking Sign out revoked the customer's refresh token too. For an
  // ordinary user, signing out of one browser and finding themselves signed
  // out of their phone is a surprise, not a security feature.
  await supabase.auth.signOut({ scope: 'local' });
  return NextResponse.redirect(siteUrl(request, '/login'), { status: 303 });
}
