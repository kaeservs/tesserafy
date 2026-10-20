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
 *
 * A token is for one call, named when it is asked for: a live call the
 * caller started and that has not ended (`tokenFor`).
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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isCallId(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value);
}

/**
 * How long a live call can still be going on. Nothing marks one as stopped:
 * a call is live for as long as lines may be added to it, which
 * append_live_segment allows for twelve hours after it starts. After that it
 * has ended, as far as anything here can tell.
 */
export const LIVE_CALL_HOURS = 12;

/** The call a token is asked for, as the caller can read it (RLS), or null when they cannot. */
export interface CallForToken {
  readonly added_by: string | null;
  readonly captured_live: boolean;
  readonly created_at: string;
}

/**
 * Whether a token may be granted for this call: one started live, by this
 * person, that could still be going on. A call the caller cannot read — in
 * another company, or no such id — reads the same as a colleague's: not
 * theirs.
 */
export function tokenFor(call: CallForToken | null, userId: string, now: Date = new Date()): 'going' | 'not theirs' | 'ended' {
  if (!call || !call.captured_live || call.added_by !== userId) return 'not theirs';
  const started = Date.parse(call.created_at);
  if (!Number.isFinite(started) || now.getTime() - started > LIVE_CALL_HOURS * 3_600_000) return 'ended';
  return 'going';
}
