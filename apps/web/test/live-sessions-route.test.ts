/**
 * Starting a live call (POST /api/live/sessions) asks whether the plan has
 * live minutes left before it makes the call. The overlay creates the call
 * first and then asks for its transcription token (ADR 0022), so a call
 * refused only at the token, for want of minutes, was left behind empty.
 */
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

let minutesLeft: boolean;
let rpcCalls: string[];

const db = {
  rpc: async (name: string) => {
    rpcCalls.push(name);
    if (name === 'plan_has_allowance') return { data: minutesLeft, error: null };
    if (name === 'start_live_conversation') return { data: 'c0ffee00-0000-4000-8000-000000000001', error: null };
    return { data: null, error: null };
  },
};

vi.mock('@/lib/supabase/caller', () => ({ caller: async () => ({ db, userId: 'u1' }) }));
vi.mock('@/lib/live-input', () => ({ liveAllowedFor: async () => true }));
vi.mock('@/lib/consent', async (actual) => ({
  ...(await actual<typeof import('@/lib/consent')>()),
  currentAgreement: async () => ({ agreedAt: '2026-10-01T09:00:00Z', termsVersion: '2026-10' }),
}));

const { POST } = await import('@/app/api/live/sessions/route');

function start() {
  return POST(
    new NextRequest('https://app.example.com/api/live/sessions', {
      method: 'POST',
      body: JSON.stringify({ title: 'Live call' }),
      headers: { 'content-type': 'application/json' },
    }),
  );
}

beforeEach(() => {
  minutesLeft = true;
  rpcCalls = [];
});

describe('POST /api/live/sessions', () => {
  it('makes the call when the plan has live minutes left', async () => {
    const response = await start();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ conversationId: 'c0ffee00-0000-4000-8000-000000000001' });
    expect(rpcCalls).toContain('start_live_conversation');
  });

  it('makes no call when none are left, and offers the plan page', async () => {
    minutesLeft = false;

    const response = await start();

    expect(response.status).toBe(402);
    await expect(response.json()).resolves.toEqual({
      error: 'Your plan has no live minutes left this month.',
      upgrade: '/settings/membership',
    });
    expect(rpcCalls).not.toContain('start_live_conversation');
  });
});
