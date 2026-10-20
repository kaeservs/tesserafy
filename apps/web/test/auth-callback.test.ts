/**
 * /auth/callback no longer verifies a token_hash link. Nothing sends one, and
 * verifying one signed the browser in at once, over whoever was signed in,
 * without saying as whom: a link anyone can make for their own account would
 * quietly sign a customer into it. /auth/confirm, which asks first, is where
 * such a link belongs.
 */
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

let verified: unknown[];
let exchanged: string[];

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: {
      verifyOtp: async (params: unknown) => {
        verified.push(params);
        return { data: {}, error: null };
      },
      exchangeCodeForSession: async (code: string) => {
        exchanged.push(code);
        return { data: {}, error: null };
      },
    },
  }),
}));

const { GET } = await import('@/app/auth/callback/route');

const visit = (query: string) => GET(new NextRequest(`https://app.example.com/auth/callback${query}`, { headers: { host: 'app.example.com' } }));

beforeEach(() => {
  verified = [];
  exchanged = [];
});

describe('/auth/callback', () => {
  it('signs nobody in from a token_hash link, and says the link carried nothing it reads', async () => {
    const response = await visit('?token_hash=pkce_abc&type=magiclink');

    expect(verified).toEqual([]);
    expect(response.headers.get('location')).toBe('https://app.example.com/login?error=no_credentials');
  });

  it('still completes the PKCE flow and carries Supabase’s refusal through', async () => {
    expect((await visit('?code=c1')).headers.get('location')).toBe('https://app.example.com/conversations');
    expect(exchanged).toEqual(['c1']);
    expect((await visit('?error=access_denied&error_code=otp_expired')).headers.get('location')).toBe(
      'https://app.example.com/login?error=otp_expired',
    );
  });
});
