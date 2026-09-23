import { createServerClient } from '@supabase/ssr';
import type { Database } from '@tesserafy/db';
import { cookies } from 'next/headers';
import { publicSupabaseEnv } from '../env';

/**
 * A per-request client acting as the signed-in operator.
 *
 * Every query it makes is filtered by RLS, and every admin function it calls
 * checks `is_platform_admin()` for itself. This is the client nearly all of
 * this console uses; the service-role one lives in lib/admin.ts and does
 * exactly one thing.
 */
export async function createClient() {
  // cookies() first: it marks the route as per-request, so `next build` never
  // tries to prerender an authenticated page without credentials.
  const cookieStore = await cookies();
  const { url, publishableKey } = publicSupabaseEnv();

  return createServerClient<Database>(url, publishableKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Server Components cannot set cookies. The proxy refreshes the
          // session on every request, so this is safe to ignore here.
        }
      },
    },
  });
}
