/** The overlay's transcription token: Deepgram's key stays here, every stream opts out of model training, and a token is for one live call. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { grantToken, isCallId, LIVE_CALL_HOURS, streamUrl, tokenFor, transcriptionAvailable } from '@/lib/transcription';

afterEach(() => vi.unstubAllEnvs());

describe('transcription', () => {
  it('is off until a key is set', () => {
    vi.stubEnv('DEEPGRAM_API_KEY', '');
    expect(transcriptionAvailable()).toBe(false);
  });

  it('trades the key for a one-minute token, and never hands out the key', async () => {
    vi.stubEnv('DEEPGRAM_API_KEY', 'dg-secret');
    const doFetch = vi.fn(async (_url: string, _init: RequestInit) => new Response(JSON.stringify({ access_token: 'short', expires_in: 60 }), { status: 200 }));
    await expect(grantToken(doFetch as unknown as typeof fetch)).resolves.toEqual({ token: 'short', expiresIn: 60 });
    const [url, init] = doFetch.mock.calls[0]!;
    expect(url).toBe('https://api.deepgram.com/v1/auth/grant');
    expect((init.headers as Record<string, string>)['authorization']).toBe('Token dg-secret');
    expect(JSON.parse(String(init.body))).toEqual({ ttl_seconds: 60 });
  });

  it('streams with the settings chosen here, opted out of model improvement', () => {
    const url = new URL(streamUrl());
    expect(url.protocol).toBe('wss:');
    expect(url.searchParams.get('mip_opt_out')).toBe('true');
    expect(url.searchParams.get('interim_results')).toBe('true');
  });
});

describe('which call a token is for', () => {
  const now = new Date('2026-10-19T12:00:00Z');
  const startedAt = (hours: number) => new Date(now.getTime() - hours * 3_600_000).toISOString();
  const mine = { added_by: 'u1', captured_live: true, created_at: startedAt(1) };

  it('is a live call this person started, while lines may still be added to it', () => {
    expect(tokenFor(mine, 'u1', now)).toBe('going');
    expect(tokenFor({ ...mine, created_at: startedAt(LIVE_CALL_HOURS - 0.01) }, 'u1', now)).toBe('going');
    expect(tokenFor({ ...mine, created_at: startedAt(LIVE_CALL_HOURS + 0.01) }, 'u1', now)).toBe('ended');
    expect(tokenFor({ ...mine, created_at: 'not a date' }, 'u1', now)).toBe('ended');
  });

  it('is never a colleague’s call, an imported one, or one this person cannot read', () => {
    expect(tokenFor({ ...mine, added_by: 'u2' }, 'u1', now)).toBe('not theirs');
    expect(tokenFor({ ...mine, added_by: null }, 'u1', now)).toBe('not theirs');
    expect(tokenFor({ ...mine, captured_live: false }, 'u1', now)).toBe('not theirs');
    expect(tokenFor(null, 'u1', now)).toBe('not theirs');
  });

  it('is named by an id and nothing else', () => {
    expect(isCallId('6F1C2B8E-3D4A-4F5B-9C6D-7E8F9A0B1C2D')).toBe(true);
    for (const value of [undefined, null, 42, '', '6f1c2b8e-3d4a-4f5b-9c6d', '------------------------------------', '6f1c2b8e-3d4a-4f5b-9c6d-7e8f9a0b1c2d/x']) {
      expect(isCallId(value), String(value)).toBe(false);
    }
  });
});
