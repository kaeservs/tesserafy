/**
 * Bare names are allowed, and become an address here.
 *
 * Supabase identifies a user by email; "kaeser" is not one. Rather than teach
 * the rest of the app about usernames, the mapping happens once, at the only
 * place a person types an identifier. Anything containing @ is taken as
 * written; anything else is a username.
 *
 * `.local` is deliberate. It is reserved and cannot receive mail, so an
 * account on this domain can only ever sign in with a password — a test
 * account that could also be emailed a link would be a second way in that
 * nobody remembers to close.
 *
 * Its own module rather than living in actions.ts because 'use server' makes
 * every export an HTTP endpoint, and a pure string function has no business
 * being one.
 */
export const USERNAME_DOMAIN = 'tesserafy.local';

export function toEmail(identifier: string): string {
  const trimmed = identifier.trim();
  return trimmed.includes('@') ? trimmed : `${trimmed.toLowerCase()}@${USERNAME_DOMAIN}`;
}
