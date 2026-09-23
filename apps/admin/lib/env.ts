/**
 * Browser-safe configuration only.
 *
 * This console does hold the service-role key, unlike the web app — that is
 * why it is a separate deployment. It is read in exactly one place,
 * lib/admin.ts, and never here: anything this function returns can reach a
 * browser bundle, and the difference between the two is the whole reason the
 * two apps exist.
 *
 * Read lazily so `next build` does not need live credentials; a missing value
 * fails the first request with a clear message instead.
 */
export function publicSupabaseEnv(): { url: string; publishableKey: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !publishableKey) {
    throw new Error(
      'NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY must be set. ' +
        'Locally: apps/admin/.env.local. On Vercel: Project → Settings → Environment Variables.',
    );
  }
  return { url, publishableKey };
}
