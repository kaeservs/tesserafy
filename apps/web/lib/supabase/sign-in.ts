import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { publicSupabaseEnv } from '../env';

/**
 * The client that sends sign-in emails, and the only one using the implicit
 * flow.
 *
 * PKCE binds a sign-in to the browser that requested it by keeping a verifier
 * cookie there. That is the stronger flow and the wrong one for email: people
 * request a link in one browser and open their mail in another, and the result
 * is `pkce_code_verifier_not_found` — a failure with no explanation a user can
 * act on.
 *
 * Implicit returns the session in the URL fragment instead, so any browser can
 * complete it. The cost is tokens in browser history, which is why this client
 * exists only for sign-in; everything else uses the ordinary server client.
 */
export async function createSignInClient() {
  const cookieStore = await cookies();
  const { url, publishableKey } = publicSupabaseEnv();

  return createServerClient(url, publishableKey, {
    auth: { flowType: 'implicit' },
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
          // Server Components cannot set cookies; the proxy refreshes the
          // session on every request, so this is safe to ignore.
        }
      },
    },
  });
}
