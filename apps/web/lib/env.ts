/**
 * Browser-safe configuration only. The service-role key must never be read
 * anywhere under apps/web — scripts/check-retrieval-guard.mjs fails CI if it is.
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
        'Locally: copy .env.example to apps/web/.env.local. On Vercel: Project → Settings → Environment Variables.',
    );
  }
  return { url, publishableKey };
}
