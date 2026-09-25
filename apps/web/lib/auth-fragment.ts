/**
 * Reading a session out of a URL fragment.
 *
 * The implicit flow returns tokens after the '#', which a server never
 * receives — so this runs in the browser and is the one place that parsing
 * happens. Pure, because the interesting part is the edge cases: Supabase puts
 * errors in the same fragment, and a half-populated fragment must not be
 * mistaken for a session.
 */

export interface FragmentSession {
  accessToken: string;
  refreshToken: string;
  /**
   * The link was an invitation: the account was just made by an operator and
   * has no password. Where it lands next depends on it.
   */
  invited: boolean;
}

export interface FragmentError {
  code: string;
  description: string | null;
}

export type FragmentResult =
  | { kind: 'session'; session: FragmentSession }
  | { kind: 'error'; error: FragmentError }
  | { kind: 'empty' };

export function parseAuthFragment(hash: string): FragmentResult {
  const params = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash);

  const errorCode = params.get('error_code') ?? params.get('error');
  if (errorCode) {
    return {
      kind: 'error',
      error: { code: errorCode, description: params.get('error_description') },
    };
  }

  const accessToken = params.get('access_token');
  const refreshToken = params.get('refresh_token');

  // Both or neither. A session without a refresh token expires in an hour with
  // no way back, which looks like a random logout later rather than a failure
  // now.
  if (accessToken && refreshToken) {
    return {
      kind: 'session',
      session: { accessToken, refreshToken, invited: params.get('type') === 'invite' },
    };
  }

  return { kind: 'empty' };
}
