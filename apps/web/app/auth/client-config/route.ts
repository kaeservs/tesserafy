import { NextResponse } from 'next/server';
import { USERNAME_DOMAIN } from '@/app/(auth)/login/identifier';
import { publicSupabaseEnv } from '@/lib/env';

/**
 * What a client outside the browser needs to sign in: where Auth is, the
 * publishable key, and the username rule.
 *
 * All of it is public already — the same two values are compiled into every
 * page this app serves — so this hands out nothing a visitor could not read
 * from the page source. It exists so the desktop overlay can be configured
 * with one address, the product's, rather than three.
 *
 * Under /auth/ rather than /api/ because the proxy answers every signed-out
 * /api/ request with 401, and a client asking how to sign in is signed out by
 * definition.
 */
export function GET() {
  const { url, publishableKey } = publicSupabaseEnv();
  return NextResponse.json(
    { supabaseUrl: url, publishableKey, usernameDomain: USERNAME_DOMAIN },
    { headers: { 'cache-control': 'public, max-age=300' } },
  );
}
