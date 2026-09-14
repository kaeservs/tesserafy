import { NextResponse, type NextRequest } from 'next/server';
import { siteUrl } from '@/lib/site-url';
import { createClient } from '@/lib/supabase/server';

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  await supabase.auth.signOut();
  return NextResponse.redirect(siteUrl(request, '/login'), { status: 303 });
}
