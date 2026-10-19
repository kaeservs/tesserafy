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
let asked = 0;

vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: {
      getUser: async () => {
        asked += 1;
        return { data: { user: signedIn ? { id: 'u1' } : null }, error: null };
      },
    },
  }),
}));

const { updateSession } = await import('../lib/supabase/proxy');

function request(path: string, headers: Record<string, string> = {}, method = 'GET'): NextRequest {
  return new NextRequest(`https://app.example.com${path}`, { headers, method });
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

  it('lets Stripe’s webhook through unsigned-in — its signature is checked further in — and nothing beside it', async () => {
    signedIn = false;

    expect((await updateSession(request('/api/stripe/webhook'))).status).toBe(200);
    expect((await updateSession(request('/api/stripe/webhook/x'))).status).toBe(401);
    expect((await updateSession(request('/api/stripe'))).status).toBe(401);
  });

  it('lets a signed-in browser caller through', async () => {
    signedIn = true;

    const response = await updateSession(request('/api/detect'));

    expect(response.status).toBe(200);
  });
});

/**
 * SameSite=Lax keeps the session cookie off another site's POST, but a page
 * on n8n.tesserafy.com, or any sibling host, is the same site, and its POST
 * arrives with the visitor's cookies. Its Origin is what gives it away.
 */
describe('updateSession on writes to /api from another host', () => {
  it('refuses one, before asking the auth server who is signed in', async () => {
    signedIn = true;
    asked = 0;

    const response = await updateSession(request('/api/detect', { origin: 'https://n8n.example.com' }, 'POST'));

    expect(response.status).toBe(403);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(asked).toBe(0);
  });

  it('refuses every method that changes something, and an Origin that names no host', async () => {
    signedIn = true;

    for (const method of ['PUT', 'PATCH', 'DELETE']) {
      expect((await updateSession(request('/api/preps/p1', { origin: 'https://n8n.example.com' }, method))).status, method).toBe(403);
    }
    // A sandboxed frame's Origin.
    expect((await updateSession(request('/api/detect', { origin: 'null' }, 'POST'))).status).toBe(403);
  });

  it('lets the app’s own pages write, on the host the request was sent to', async () => {
    signedIn = true;

    expect((await updateSession(request('/api/detect', { origin: 'https://app.example.com' }, 'POST'))).status).toBe(200);
    // Behind Vercel, the host the visitor used arrives forwarded.
    const forwarded = request(
      '/api/detect',
      { origin: 'https://app.tesserafy.com', 'x-forwarded-host': 'app.tesserafy.com', host: 'internal.example' },
      'POST',
    );
    expect((await updateSession(forwarded)).status).toBe(200);
  });

  it('lets a write with no Origin through: the overlay calls from its main process, which sends none', async () => {
    signedIn = false;

    const response = await updateSession(request('/api/detect', { authorization: 'Bearer token' }, 'POST'));

    expect(response.status).toBe(200);
  });

  it('leaves reads alone', async () => {
    signedIn = true;

    expect((await updateSession(request('/api/live/setup', { origin: 'https://n8n.example.com' }))).status).toBe(200);
  });

  it('leaves Stripe’s webhook to its signature, by name rather than by its missing Origin', async () => {
    signedIn = false;

    const response = await updateSession(request('/api/stripe/webhook', { origin: 'https://n8n.example.com' }, 'POST'));

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
