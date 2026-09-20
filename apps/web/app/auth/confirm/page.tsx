'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { parseAuthFragment } from '@/lib/auth-fragment';
import { createClient } from '@/lib/supabase/browser';

/**
 * Where an emailed sign-in link lands.
 *
 * This is a page rather than a route handler because the session arrives in
 * the URL fragment, and a fragment is never sent to a server. The page reads
 * it, hands it to a browser client which writes the session into cookies, and
 * from that point everything is server-rendered as before.
 *
 * The tradeoff, recorded honestly: tokens in a fragment end up in browser
 * history. PKCE avoids that by binding sign-in to the browser that started it,
 * which is exactly what breaks when an email client opens the link somewhere
 * else — and a sign-in that only works if you open your mail in the right
 * browser is not a sign-in. Custom SMTP plus a token_hash link is better than
 * both; this is what works without it.
 */
export default function ConfirmPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const result = parseAuthFragment(window.location.hash);

    if (result.kind === 'error') {
      setError(result.error.code);
      return;
    }
    if (result.kind === 'empty') {
      setError('no_credentials');
      return;
    }

    const supabase = createClient();
    void supabase.auth
      .setSession({
        access_token: result.session.accessToken,
        refresh_token: result.session.refreshToken,
      })
      .then(({ error: sessionError }) => {
        if (sessionError) {
          setError(sessionError.code ?? 'session_failed');
          return;
        }
        // Drop the fragment before navigating, so the tokens do not sit in the
        // address bar or get carried into the next page's history entry.
        window.history.replaceState(null, '', '/auth/confirm');
        router.replace('/conversations');
      });
  }, [router]);

  if (error) {
    router.replace(`/login?error=${encodeURIComponent(error)}`);
  }

  return (
    <main>
      <h1>Signing you in…</h1>
      <p className="muted">One moment.</p>
    </main>
  );
}
