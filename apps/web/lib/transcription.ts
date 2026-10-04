/**
 * Live transcription of both sides of a call (ADR 0022), through Deepgram.
 *
 * The overlay streams two channels — the seller's microphone and the
 * computer's sound output, which is what the meeting app plays — and each
 * comes back as text from its own side. The overlay never holds Deepgram's
 * key: it asks this server for a token that lasts a minute, enough to open a
 * stream, which stays open after the token expires.
 *
 * The audio goes to Deepgram for that call's transcript and nothing else:
 * every stream opts out of Deepgram's model improvement (`mip_opt_out`), as
 * calls are never used for anyone's own purposes.
 */

export function transcriptionAvailable(): boolean {
  return Boolean(process.env['DEEPGRAM_API_KEY']?.trim());
}

/** The stream the overlay opens, with everything but the token decided here. */
export function streamUrl(): string {
  const params = new URLSearchParams({
    model: 'nova-3',
    language: 'en',
    smart_format: 'true',
    punctuate: 'true',
    interim_results: 'true',
    endpointing: '300',
    utterance_end_ms: '1000',
    vad_events: 'true',
    mip_opt_out: 'true',
  });
  return `wss://api.deepgram.com/v1/listen?${params}`;
}

export class TranscriptionRefused extends Error {
  override readonly name = 'TranscriptionRefused';
}

/** A short-lived token for one call's streams, from Deepgram's own token endpoint. */
export async function grantToken(doFetch: typeof fetch = fetch): Promise<{ token: string; expiresIn: number }> {
  const key = process.env['DEEPGRAM_API_KEY']?.trim();
  if (!key) throw new TranscriptionRefused('transcription is not switched on for this deployment');
  const response = await doFetch('https://api.deepgram.com/v1/auth/grant', {
    method: 'POST',
    headers: { authorization: `Token ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ ttl_seconds: 60 }),
  });
  const body = (await response.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; err_msg?: string };
  if (!response.ok || !body.access_token) {
    throw new Error(`Deepgram refused a token: ${response.status} ${body.err_msg ?? ''}`.trim());
  }
  return { token: body.access_token, expiresIn: body.expires_in ?? 60 };
}
