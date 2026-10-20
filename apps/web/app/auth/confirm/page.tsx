'use client';

import type { Session } from '@supabase/supabase-js';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { parseAuthFragment } from '@/lib/auth-fragment';
import { createClient, sessionFromLink } from '@/lib/supabase/browser';

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
 * the address a link signs in as is always shown. Both are decided by the
 * account Auth says the link is for (sessionFromLink), never by the claims in
 * its access token, which anyone can write: a forged one naming the person's
 * own account once skipped the question and showed their own address. The
 * token_hash link, once email is ours, removes the fragment altogether.
 */

/** A link's session, from Auth, waiting on the go-ahead to replace another account's. */
interface Pending {
  session: Session;
  invited: boolean;
}

export default function ConfirmPage() {
  const router = useRouter();
  const [failure, setFailure] = useState<string | null>(null);
  const [linkFor, setLinkFor] = useState<string | null>(null);
  // Signed in as someone else: who, and the link's session until they decide.
  const [already, setAlready] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const started = useRef(false);

  const signIn = useCallback(
    async ({ session, invited }: Pending) => {
      const { error: sessionError } = await createClient().auth.setSession({
        access_token: session.access_token,
        refresh_token: session.refresh_token,
      });
      if (sessionError) {
        setFailure(sessionError.code ?? 'session_failed');
        return;
      }
      // An invited account was made by an operator and has no password;
      // without one the person could only sign in again by email.
      router.replace(invited ? '/account?invited=1' : '/conversations');
    },
    [router],
  );

  useEffect(() => {
    // Once. The link's refresh token is spent below, and spending it again —
    // React runs effects twice in development — can make Auth revoke the
    // session the first spend opened.
    if (started.current) return;
    started.current = true;

    const result = parseAuthFragment(window.location.hash);

    if (result.kind === 'error') {
      setFailure(result.error.code);
      return;
    }
    if (result.kind === 'empty') {
      setFailure('no_credentials');
      return;
    }

    // Drop the fragment at once, so the tokens do not sit in the address bar
    // or in history, and a reload does not try to spend them again.
    window.history.replaceState(null, '', '/auth/confirm');
    void (async () => {
      const link = await sessionFromLink(result.session.refreshToken);
      if ('error' in link) {
        setFailure(link.error);
        return;
      }
      setLinkFor(link.session.user.email ?? null);
      const { data } = await createClient().auth.getUser();
      const opened = { session: link.session, invited: result.session.invited };
      if (data.user && data.user.id !== link.session.user.id) {
        setAlready(data.user.email ?? 'another account');
        setPending(opened);
        return;
      }
      await signIn(opened);
    })();
  }, [signIn]);

  // In an effect, not in the render body. Navigating while rendering updates
  // the router mid-render, which React warns about and, under Strict Mode,
  // re-runs — the failure path was the one place this page could loop.
  useEffect(() => {
    if (failure) router.replace(`/login?error=${encodeURIComponent(failure)}`);
  }, [failure, router]);

  if (already && pending) {
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
          <button
            type="button"
            onClick={() => {
              setAlready(null);
              void signIn(pending);
            }}
          >
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
