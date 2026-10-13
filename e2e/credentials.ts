/**
 * The account the end-to-end tests sign in as: from the environment only —
 * `.env` locally, Actions secrets in CI.
 *
 * It used to be a fallback in every spec, and the repository is public: a
 * password in a file is a password published, and history keeps it after the
 * file forgets (security review, 2026-10-12). A spec that signs in now fails
 * loudly without these rather than quietly using a value anyone can read.
 */
function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set: the end-to-end tests sign in with it (.env locally, Actions secrets in CI).`);
  }
  return value;
}

export const USERNAME = required('E2E_USERNAME');
export const PASSWORD = required('E2E_PASSWORD');

/** The address a bare username signs in as (apps/web/app/(auth)/login/identifier.ts). */
export const EMAIL = USERNAME.includes('@') ? USERNAME : `${USERNAME}@tesserafy.local`;
