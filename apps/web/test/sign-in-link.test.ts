/**
 * /auth/confirm decides whether to ask "switch accounts?", and which address
 * to show, from the account Auth says a link is for. It used to read both
 * from the link's access token, which anyone can write: a forged token naming
 * the visitor's own account skipped the question, showed their own address,
 * and setSession then signed them in with the link's refresh token, someone
 * else's. sessionFromLink spends that refresh token with Auth, keeps nothing,
 * and answers with the session and account Auth issued.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/env', () => ({
  publicSupabaseEnv: () => ({ url: 'https://example.supabase.co', publishableKey: 'sb_publishable_x' }),
}));

const { sessionFromLink } = await import('../lib/supabase/browser');

const STRANGER = { id: '00000000-0000-4000-8000-0000000000bb', aud: 'authenticated', email: 'stranger@example.com', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' };

let asked: { url: string; body: unknown }[];

beforeEach(() => {
  asked = [];
  vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    asked.push({ url, body: JSON.parse(String(init?.body ?? 'null')) });
    const { refresh_token } = JSON.parse(String(init?.body ?? '{}')) as { refresh_token?: string };
    if (refresh_token !== 'the-strangers-refresh-token') {
      return Response.json({ code: 400, error_code: 'refresh_token_not_found', msg: 'Invalid Refresh Token: Refresh Token Not Found' }, { status: 400 });
    }
    return Response.json({ access_token: 'issued.by.auth', refresh_token: 'rotated', token_type: 'bearer', expires_in: 3600, user: STRANGER });
  });
});

afterEach(() => vi.unstubAllGlobals());

describe('sessionFromLink', () => {
  it('names the account Auth issued the session for, whatever the link’s access token claimed', async () => {
    const link = await sessionFromLink('the-strangers-refresh-token');

    expect('session' in link && link.session.user.id).toBe(STRANGER.id);
    expect('session' in link && link.session.user.email).toBe('stranger@example.com');
    // The session to write is the one Auth just issued, not the link's own.
    expect('session' in link && link.session.refresh_token).toBe('rotated');
    expect(asked).toEqual([
      { url: 'https://example.supabase.co/auth/v1/token?grant_type=refresh_token', body: { refresh_token: 'the-strangers-refresh-token' } },
    ]);
  });

  it('answers with Auth’s reason when the link is spent or made up, for the login page to name', async () => {
    expect(await sessionFromLink('also-not-real')).toEqual({ error: 'refresh_token_not_found' });
  });
});
