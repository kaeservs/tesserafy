/**
 * Starting a call whose two sides are transcribed (ADR 0022), in the one
 * order that works.
 *
 * The audio first: a call nobody can be heard on is not worth a record. Then
 * the call itself, on the server. Then the transcription streams, whose token
 * the server grants only for a live call this person started and that is
 * still going — so the request names the call, and without one there is no
 * token to ask for. It used to be asked for before the call existed, which
 * made it a token for no call at all: anyone with live minutes could have
 * opened streams on our Deepgram account with no call attached to them.
 *
 * Whatever step fails says why, the steps after it are never asked, and the
 * audio already taken is let go.
 */

/** Why a call could not start, in words for the status line. */
export interface Refusal {
  readonly error: string;
  /** The plan ran out of something: there is a page to change it on. */
  readonly upgrade?: boolean;
}

/** What a step that may be refused answers, as the main process passes it on. */
interface Answer {
  readonly error?: string;
  readonly upgrade?: boolean;
}

export interface StartSteps<Audio> {
  /** The microphone and the computer's sound output, or why not. */
  audio(): Promise<Audio | Refusal>;
  /** The call, created on the server. */
  call(): Promise<Answer & { readonly conversationId?: string }>;
  /** The transcription streams, for that call. */
  transcribe(conversationId: string): Promise<Answer & { readonly ok?: boolean }>;
  /** The audio is not needed after all. */
  release(audio: Audio): void;
}

export type Started<Audio> = { readonly audio: Audio; readonly conversationId: string } | Refusal;

export function isRefusal(value: unknown): value is Refusal {
  return typeof value === 'object' && value !== null && typeof (value as { error?: unknown }).error === 'string';
}

function refusal(answer: Answer, otherwise: string): Refusal {
  return { error: answer.error ?? otherwise, ...(answer.upgrade ? { upgrade: true } : {}) };
}

export async function startCall<Audio>(steps: StartSteps<Audio>): Promise<Started<Audio>> {
  const audio = await steps.audio();
  if (isRefusal(audio)) return audio;
  const call = await steps.call();
  if (call.error || !call.conversationId) {
    steps.release(audio);
    return refusal(call, 'The call could not be started.');
  }
  const opened = await steps.transcribe(call.conversationId);
  if (opened.error || !opened.ok) {
    steps.release(audio);
    return refusal(opened, 'Transcription could not start.');
  }
  return { audio, conversationId: call.conversationId };
}
