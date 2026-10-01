import type { SupabaseClient } from '@tesserafy/db';

/**
 * Whether this request comes from a support session that is over — one an
 * operator opened (console, open_support_access) whose time ran out or which
 * they ended. The database decides (support_session_ended: the session began
 * inside a support window that has since closed); the caller signs it out.
 *
 * Asked only of a session started by a sign-in link. A support session always
 * is one — the console mints a magic link — and a password session never is,
 * so the overlay's detections, which sign in with a password and run against
 * a latency budget, pay nothing for this.
 *
 * Fails open: a database error leaves the request alone rather than signing
 * a customer out over a hiccup. What it guards is one more request from a
 * session whose window has closed; the next page asks again.
 */
export async function supportSessionEnded(db: SupabaseClient, accessToken: string | null | undefined): Promise<boolean> {
  if (!accessToken || !signedInByLink(accessToken)) return false;
  const { data, error } = await db.rpc('support_session_ended');
  return !error && data === true;
}

/** True unless every way this session was signed into was a password. */
export function signedInByLink(accessToken: string): boolean {
  try {
    const payload = accessToken.split('.')[1] ?? '';
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { amr?: unknown };
    if (!Array.isArray(claims.amr) || claims.amr.length === 0) return true;
    return !claims.amr.every((entry) => (entry as { method?: unknown } | null)?.method === 'password');
  } catch {
    return true;
  }
}
