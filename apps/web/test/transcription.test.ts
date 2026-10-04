/** The overlay's transcription token: Deepgram's key stays here, and every stream opts out of model training. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { grantToken, streamUrl, transcriptionAvailable } from '@/lib/transcription';

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
