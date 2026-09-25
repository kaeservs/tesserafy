/**
 * What a person confirms before a call is kept.
 *
 * One strict statement rather than a model of jurisdictions: "everyone was
 * told and agreed" satisfies the strictest two-party rule, and a product that
 * guessed which rule applied to a call would be guessing about a law.
 *
 * The wording lives on the server and is stored verbatim with the call. The
 * browser sends only that the box was ticked; the route chooses the words.
 * So what a call records is exactly what the person was shown, and rewording
 * this later does not change what an earlier call agreed to.
 *
 * Changing either string is a product and legal decision, not a copy edit.
 */
export const CONSENT_STATEMENTS = {
  /** Shown before a transcript is imported: the call has already happened. */
  imported:
    'Everyone on this call was told it was being recorded, transcribed and analysed, and agreed to it.',
  /** Shown before a live call is kept: it is happening now. */
  live: 'Everyone on this call has been told it is being recorded, transcribed and analysed, and has agreed to it.',
} as const;

/** What the routes say when the confirmation is missing. */
export const CONSENT_REQUIRED =
  'Confirm that everyone on the call was told it was being recorded and agreed to it.';

/** A form checkbox is "on" when ticked; JSON says `true`. Nothing else counts. */
export function consentConfirmed(value: unknown): boolean {
  return value === true || value === 'on' || value === 'yes';
}
