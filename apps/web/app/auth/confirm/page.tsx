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
 *
 * A link can be made by anyone from their own session, and any page forwards
 * a fragment here (catch-session), so a link could sign someone into an
 * account that is not theirs — their next upload landing in a stranger's
 * company. Someone already signed in as another account is asked first, and
 * the address a link signs in as is always shown. The token_hash link, once
 * email is ours, removes the fragment altogether.
 */

/** Who a sign-in link is for, read from its access token. Nothing is trusted from it. */
function subjectOf(accessToken: string): { id: string | null; email: string | null } {
  try {
    const part = accessToken.split('.')[1] ?? '';
    const json = atob(part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '='));
    const claims = JSON.parse(json) as { sub?: unknown; email?: unknown };
    return {
      id: typeof claims.sub === 'string' ? claims.sub : null,
      email: typeof claims.email === 'string' ? claims.email : null,
    };
  } catch {
    return { id: null, email: null };
  }
}
export default function ConfirmPage() {
  const router = useRouter();
  const [failure, setFailure] = useState<string | null>(null);
  const [linkFor, setLinkFor] = useState<string | null>(null);
  // Signed in as someone else: who, and the go-ahead to switch.
  const [already, setAlready] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);

  useEffect(() => {
    const result = parseAuthFragment(window.location.hash);

    if (result.kind === 'error') {
      setFailure(result.error.code);
      return;
    }
    if (result.kind === 'empty') {
      setFailure('no_credentials');
      return;
    }

    const subject = subjectOf(result.session.accessToken);
    setLinkFor(subject.email);
    const supabase = createClient();
    void (async () => {
      if (!confirmed) {
        const { data } = await supabase.auth.getUser();
        if (data.user && data.user.id !== subject.id) {
          setAlready(data.user.email ?? 'another account');
          return;
        }
      }
      await supabase.auth
      .setSession({
        access_token: result.session.accessToken,
        refresh_token: result.session.refreshToken,
      })
      .then(({ error: sessionError }) => {
        if (sessionError) {
          setFailure(sessionError.code ?? 'session_failed');
          return;
        }
        // Drop the fragment before navigating, so the tokens do not sit in the
        // address bar or get carried into the next page's history entry.
        window.history.replaceState(null, '', '/auth/confirm');
        // An invited account was made by an operator and has no password;
        // without one the person could only sign in again by email.
        router.replace(result.session.invited ? '/account?invited=1' : '/conversations');
      });
    })();
  }, [router, confirmed]);

  // In an effect, not in the render body. Navigating while rendering updates
  // the router mid-render, which React warns about and, under Strict Mode,
  // re-runs — the failure path was the one place this page could loop.
  useEffect(() => {
    if (failure) router.replace(`/login?error=${encodeURIComponent(failure)}`);
  }, [failure, router]);

  if (already && !confirmed) {
    return (
      <main>
        <h1>Switch accounts?</h1>
        <p>
          You are signed in as <strong>{already}</strong>. This link signs in as <strong>{linkFor ?? 'a different account'}</strong>.
        </p>
        <p className="muted">If you did not ask for this link, stay where you are.</p>
        <div className="toolbar">
          <button type="button" onClick={() => router.replace('/conversations')}>
            Stay as {already}
          </button>
          <button type="button" onClick={() => setConfirmed(true)}>
            Switch to {linkFor ?? 'the other account'}
          </button>
        </div>
      </main>
    );
  }

  return (
    <main>
      <h1>{failure ? 'That link did not work' : 'Signing you in…'}</h1>
      <p className="muted">{failure ? 'Taking you back to sign in…' : linkFor ? `As ${linkFor}. One moment.` : 'One moment.'}</p>
    </main>
  );
}
