/**
 * The session cookie as a browser receives it: Secure, so it never travels
 * over plain http; SameSite=Lax; and still readable by script, which is how
 * /auth/confirm writes it. @supabase/ssr's own defaults leave Secure off.
 *
 * Through the real @supabase/ssr, with Auth answered here at fetch, because
 * options passed to a client only show where a cookie is actually written.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SESSION_COOKIE as CONSOLE_COOKIE } from '../../admin/lib/supabase/cookies';
import { SESSION_COOKIE } from '../lib/supabase/cookies';

vi.mock('../lib/env', () => ({
  publicSupabaseEnv: () => ({ url: 'https://example.supabase.co', publishableKey: 'sb_publishable_x' }),
}));

/** What a server action wrote through next/headers. */
const written: { name: string; options: Record<string, unknown> }[] = [];

vi.mock('next/headers', () => ({
  cookies: async () => ({
    getAll: () => [],
    set: (name: string, _value: string, options: Record<string, unknown>) => {
      written.push({ name, options });
    },
  }),
}));

const STORAGE_KEY = 'sb-example-auth-token';
const USER = {
  id: '00000000-0000-4000-8000-000000000001',
  aud: 'authenticated',
  role: 'authenticated',
  email: 'seller@example.com',
  app_metadata: {},
  user_metadata: {},
  created_at: '2026-01-01T00:00:00Z',
};

function session(expiresAt: number) {
  const part = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return {
    access_token: `${part({ alg: 'HS256', typ: 'JWT' })}.${part({ sub: USER.id, exp: expiresAt })}.signature`,
    refresh_token: 'refresh-token',
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: expiresAt,
    user: USER,
  };
}

const now = () => Math.floor(Date.now() / 1000);

beforeEach(() => {
  written.length = 0;
  // Auth, as far as signing in and refreshing a session need it.
  vi.stubGlobal('fetch', async (input: string | URL | Request) => {
    const url = new URL(input instanceof Request ? input.url : input);
    if (url.pathname === '/auth/v1/token') return Response.json(session(now() + 3600));
    if (url.pathname === '/auth/v1/user') return Response.json(USER);
    return new Response('not faked here', { status: 404 });
  });
});

afterEach(() => vi.unstubAllGlobals());

describe('the session cookie', () => {
  it('is Secure, Lax and readable by script when the proxy refreshes a session', async () => {
    const { updateSession } = await import('../lib/supabase/proxy');
    const stale = `base64-${Buffer.from(JSON.stringify(session(now() - 60))).toString('base64url')}`;

    const response = await updateSession(
      new NextRequest('https://app.example.com/dashboard', { headers: { cookie: `${STORAGE_KEY}=${stale}` } }),
    );

    const lines = response.headers.getSetCookie().filter((line) => line.startsWith(STORAGE_KEY));
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(line).toMatch(/;\s*Secure/i);
      expect(line).toMatch(/;\s*SameSite=Lax/i);
      expect(line).not.toMatch(/HttpOnly/i);
    }
  });

  it('is Secure and Lax when a server action signs someone in', async () => {
    const { createClient } = await import('../lib/supabase/server');
    const supabase = await createClient();

    const { error } = await supabase.auth.signInWithPassword({ email: USER.email, password: 'a password' });

    expect(error).toBeNull();
    const cookies = written.filter((cookie) => cookie.name.startsWith(STORAGE_KEY));
    expect(cookies.length).toBeGreaterThan(0);
    for (const cookie of cookies) {
      expect(cookie.options).toMatchObject({ secure: true, sameSite: 'lax' });
      expect(cookie.options['httpOnly']).not.toBe(true);
    }
  });

  it('is the same in the operator console', () => {
    expect(SESSION_COOKIE).toEqual({ secure: true, sameSite: 'lax' });
    expect(CONSOLE_COOKIE).toEqual(SESSION_COOKIE);
  });

  it('is written that way by every Supabase client either app creates', () => {
    // A client created without the shared options writes the session with
    // the library's defaults again, Secure off. The console has no test
    // runner of its own, so its clients are held to it here.
    const apps = fileURLToPath(new URL('../../', import.meta.url));
    const creating: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (['node_modules', '.next', 'test'].includes(entry.name) || entry.name.startsWith('.')) continue;
        const path = join(dir, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (/\.tsx?$/.test(entry.name)) {
          const source = readFileSync(path, 'utf-8');
          if (/create(Server|Browser)Client(<[^>]*>)?\(/.test(source)) {
            creating.push(path.slice(apps.length));
            expect(source, path).toContain('cookieOptions: SESSION_COOKIE');
          }
        }
      }
    };
    walk(join(apps, 'web'));
    walk(join(apps, 'admin'));

    expect(creating.sort()).toEqual([
      'admin/lib/supabase/proxy.ts',
      'admin/lib/supabase/server.ts',
      'web/lib/supabase/browser.ts',
      'web/lib/supabase/proxy.ts',
      'web/lib/supabase/server.ts',
      'web/lib/supabase/sign-in.ts',
    ]);
  });
});
