import type { SupabaseClient } from '@tesserafy/db';
import { TERMS_VERSION } from './legal';

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
} as const;

/** What the routes say when the confirmation is missing. */
export const CONSENT_REQUIRED =
  'Confirm that everyone on the call was told it was being recorded and agreed to it.';

/** A form checkbox is "on" when ticked; JSON says `true`. Nothing else counts. */
export function consentConfirmed(value: unknown): boolean {
  return value === true || value === 'on' || value === 'yes';
}

/**
 * The one-time agreement for live calls (ADR 0020): what a person agrees to
 * once, in the overlay or on the web, before their first recorded call. Kept
 * verbatim in recording_agreements with the Terms version it was made under.
 * Rewording it is a new version of the Terms, and asks again.
 */
export const RECORDING_AGREEMENT =
  'Before I record any call with Tesserafy, I will tell everyone on it that it is being recorded, transcribed and analysed, and I will record only with their agreement. Doing so is my responsibility under the law that applies to the call, as the Terms of Service set out.';

/** What the live route says when the agreement has not been made. */
export const AGREEMENT_REQUIRED =
  'Agree once to tell everyone on every call you record, then start again.';

/** A person's agreement, as it is read for a call. */
export interface Agreement {
  readonly agreedAt: string;
  readonly termsVersion: string;
}

/** What a live call records as its consent: the agreement it rests on, by date and version. */
export function liveConsentStatement(agreement: Agreement): string {
  const day = agreement.agreedAt.slice(0, 10);
  return `Recorded under the agreement made on ${day} (Terms ${agreement.termsVersion}): ${RECORDING_AGREEMENT}`;
}

/** The caller's agreement under the current Terms, if they have made one (RLS: their own). */
export async function currentAgreement(db: SupabaseClient, userId: string): Promise<Agreement | null> {
  const { data } = await db
    .from('recording_agreements')
    .select('agreed_at, terms_version')
    .eq('user_id', userId)
    .eq('terms_version', TERMS_VERSION)
    .order('agreed_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ? { agreedAt: data.agreed_at, termsVersion: data.terms_version } : null;
}
