import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { publicSupabaseEnv } from '../env';

/**
 * A per-request client acting as the signed-in user. Every query it makes is
 * filtered by RLS — this is the only kind of Supabase client the web app uses.
 */
export async function createClient() {
  // cookies() first: it marks the route as per-request, so `next build` never
  // tries to prerender an authenticated page without credentials.
  const cookieStore = await cookies();
  const { url, publishableKey } = publicSupabaseEnv();

  return createServerClient(url, publishableKey, {
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
