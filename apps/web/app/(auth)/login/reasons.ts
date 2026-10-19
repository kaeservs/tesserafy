/**
 * What the login page says about a sign-in that did not work, from the code
 * its journey ended with (`/login?error=…`).
 *
 * A failed sign-in says which failure it was. One "invalid or expired"
 * message hides the difference between a link used twice, a link that sat in
 * an inbox overnight, and a misconfigured redirect — and those send a person
 * to three different fixes. The code is shown too, because the person
 * debugging it is usually not the person reading the sentence.
 *
 * Only the codes listed here, and only in these words. The address is anyone's
 * to write and send to a customer: the page used to print whatever `?error=`
 * held, so `/login?error=Call support on +1-555-0100` put a stranger's phone
 * number on Tesserafy's own sign-in page, under "That link did not work".
 * Anything else gets one line of ours and is not repeated back.
 *
 * Its own module so it can be tested: a page may export only what Next reads
 * from it.
 */
const REASONS = new Map<string, string>([
  // Supabase declining a link (/auth/callback, /auth/confirm).
  ['otp_expired', 'That link has expired or was already used. Links last an hour and work only once — request a new one.'],
  ['access_denied', 'That link is no longer valid. Request a new one.'],
  ['validation_failed', 'That link was malformed. Request a new one.'],
  ['flow_state_not_found', 'That link could not be completed. Request a new one.'],
  ['flow_state_expired', 'That link has expired. Request a new one.'],
  ['unexpected_failure', 'Signing in failed on the sign-in service’s side. Try again in a moment, or request a new link.'],
  ['server_error', 'Signing in failed on the sign-in service’s side. Try again in a moment, or request a new link.'],
  // Completing a link in this browser (/auth/callback's code, /auth/confirm's session).
  [
    'pkce_code_verifier_not_found',
    'That link could not be completed in this browser. Request a new one — links now work in any browser.',
  ],
  ['bad_code_verifier', 'That link could not be completed in this browser. Request a new one.'],
  ['exchange_failed', 'That link could not be completed. Request a new one.'],
  ['refresh_token_already_used', 'That link was already used. Links work only once — request a new one.'],
  ['refresh_token_not_found', 'That link is no longer valid. Request a new one.'],
  ['session_not_found', 'That link is no longer valid. Request a new one.'],
  ['session_expired', 'That sign-in has expired. Request a new link.'],
  ['session_failed', 'Signing in failed after the link was accepted. Request a new one.'],
  [
    'no_credentials',
    'That link arrived without a sign-in token. Request a new one; if it keeps happening, the redirect URL needs fixing.',
  ],
  // Ours (/auth/support-ended).
  ['support_ended', 'The support session has ended, so it was signed out.'],
]);

const ANYTHING_ELSE = 'That link did not work. Request a new one.';

/** What to say about a failed sign-in, and the code to show beside it: one of the listed ones, or none. */
export function signInFailure(code: string): { message: string; code: string | null } {
  const message = REASONS.get(code);
  return message === undefined ? { message: ANYTHING_ELSE, code: null } : { message, code };
}
