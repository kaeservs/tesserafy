/**
 * How the proxy treats /api.
 *
 * The bug these pin: an API route was being redirected to /login, so a
 * programmatic caller got a 307 and an HTML page where it expected JSON, and a
 * caller holding a bearer token was turned away before the route could read
 * the header — the proxy only knows about cookies.
 */
import { NextRequest } from 'next/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../lib/env', () => ({
  publicSupabaseEnv: () => ({ url: 'https://example.supabase.co', publishableKey: 'sb_publishable_x' }),
}));

let signedIn = false;

vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: {
      getUser: async () => ({ data: { user: signedIn ? { id: 'u1' } : null }, error: null }),
    },
  }),
}));

const { updateSession } = await import('../lib/supabase/proxy');

function request(path: string, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(`https://app.example.com${path}`, { headers });
}

describe('updateSession on /api routes', () => {
  it('lets a bearer-token caller through to the route', async () => {
    // The Electron overlay holds a Supabase session and no cookies. The route
    // validates the token; the proxy must not pre-empt it.
    signedIn = false;

    const response = await updateSession(request('/api/detect', { authorization: 'Bearer token' }));

    expect(response.status).toBe(200);
    expect(response.headers.get('location')).toBeNull();
  });

  it('answers 401 JSON, not a redirect, when there are no credentials at all', async () => {
    signedIn = false;

    const response = await updateSession(request('/api/detect'));

    expect(response.status).toBe(401);
    expect(response.headers.get('content-type')).toContain('application/json');
    await expect(response.json()).resolves.toEqual({ error: 'not signed in' });
  });

  it('lets a signed-in browser caller through', async () => {
    signedIn = true;

    const response = await updateSession(request('/api/detect'));

    expect(response.status).toBe(200);
  });
});

describe('updateSession on pages', () => {
  it('still redirects a signed-out visitor to login', async () => {
    signedIn = false;

    const response = await updateSession(request('/conversations'));

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toContain('/login');
  });

  it('leaves the login page alone', async () => {
    signedIn = false;

    const response = await updateSession(request('/login'));

    expect(response.status).toBe(200);
  });
});
