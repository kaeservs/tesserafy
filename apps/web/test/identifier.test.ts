/**
 * Turning what somebody types into what Supabase identifies a user by.
 *
 * Small enough to look obvious and worth pinning anyway: the sign-in form is
 * the one place in the app where a person has to get a string exactly right,
 * and every rule here changes who can get in.
 */
import { describe, expect, it } from 'vitest';
import { toEmail, USERNAME_DOMAIN } from '../app/(auth)/login/identifier';

describe('toEmail', () => {
  it('turns a bare username into an address on the password-only domain', () => {
    expect(toEmail('kaeser')).toBe(`kaeser@${USERNAME_DOMAIN}`);
  });

  it('leaves a real address alone', () => {
    // Otherwise an invited customer signing in with their own email would be
    // sent to someone else's account entirely.
    expect(toEmail('someone@company.com')).toBe('someone@company.com');
  });

  it('lower-cases a username but not an address', () => {
    // Usernames are typed by hand and shift happens; the local part of a real
    // address is case-sensitive by spec and not ours to rewrite.
    expect(toEmail('Kaeser')).toBe(`kaeser@${USERNAME_DOMAIN}`);
    expect(toEmail('Someone@Company.com')).toBe('Someone@Company.com');
  });

  it('trims what a password manager or a paste brings with it', () => {
    expect(toEmail('  kaeser  ')).toBe(`kaeser@${USERNAME_DOMAIN}`);
  });

  it('uses a domain that cannot receive mail', () => {
    // A test account that could also be emailed a sign-in link would be a
    // second way in that nobody remembers to close. .local is reserved.
    expect(USERNAME_DOMAIN.endsWith('.local')).toBe(true);
  });
});
