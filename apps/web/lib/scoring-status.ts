import { SCORE_WINDOW_SIZE } from '@tesserafy/ai';
import { AUTO_SCORE_MAX_WINDOWS } from './score-upload';

/**
 * What to tell someone looking at a conversation that has no criteria yet.
 *
 * An upload scores itself after the response, so for a minute or two after
 * arriving a conversation is legitimately unscored and about to change. That
 * is a different fact from "scoring never ran" and from "this call is too
 * long to score automatically", and the page used to say the same thing — plus
 * a terminal command — for all three.
 *
 * Nothing records that scoring is in progress, so "scoring" is inferred from
 * how recently the conversation arrived. That is honest only because the
 * window is generous: the longest call taken on is sized to finish in about
 * 190 s, and ten minutes covers that plus a cold start several times over.
 * Past it, the pass either failed — which the failure log has — or never ran.
 */

/** Long enough that a slow scoring pass has certainly finished or failed. */
export const SCORING_GRACE_MS = 10 * 60_000;

export type CapturedState =
  | { readonly kind: 'scoring' }
  | { readonly kind: 'too_long'; readonly windows: number }
  | { readonly kind: 'not_scored' };

/** Windows the scoring pass would make, without building them. */
export function windowCount(segments: number): number {
  if (segments <= 0) return 0;
  return segments <= SCORE_WINDOW_SIZE ? 1 : segments - SCORE_WINDOW_SIZE + 1;
}

export function capturedState(
  segments: number,
  createdAt: string,
  now: Date = new Date(),
): CapturedState {
  const windows = windowCount(segments);
  if (windows > AUTO_SCORE_MAX_WINDOWS) return { kind: 'too_long', windows };
  const age = now.getTime() - new Date(createdAt).getTime();
  return age < SCORING_GRACE_MS ? { kind: 'scoring' } : { kind: 'not_scored' };
}
