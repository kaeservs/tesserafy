import { NextResponse, type NextRequest } from 'next/server';
import { siteUrl } from '@/lib/site-url';
import { createClient } from '@/lib/supabase/server';

/** The magic link lands here with a one-time code to exchange for a session. */
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code');

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(siteUrl(request, '/conversations'));
    }
  }

  return NextResponse.redirect(siteUrl(request, '/login?error=link'));
}
