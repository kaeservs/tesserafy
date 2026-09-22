import { LoginForm } from './login-form';

/**
 * A failed sign-in says which failure it was. One "invalid or expired"
 * message hides the difference between a link used twice, a link that sat in
 * an inbox overnight, and a misconfigured redirect — and those send a person
 * to three different fixes. The raw code is shown too, because the person
 * debugging it is usually not the person reading the sentence.
 */
const REASONS: Record<string, string> = {
  otp_expired:
    'That link has expired or was already used. Links last an hour and work only once — request a new one.',
  access_denied: 'That link is no longer valid. Request a new one.',
  no_credentials:
    'That link arrived without a sign-in token. Request a new one; if it keeps happening, the redirect URL needs fixing.',
  validation_failed: 'That link was malformed. Request a new one.',
  flow_state_not_found:
    'That link could not be completed. Request a new one.',
  pkce_code_verifier_not_found:
    'That link could not be completed in this browser. Request a new one — links now work in any browser.',
  session_failed: 'Signing in failed after the link was accepted. Request a new one.',
  flow_state_expired: 'That link has expired. Request a new one.',
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <main>
      <h1>Sign in to Tesserafy</h1>
      <p className="muted">
        Access is by invitation. Sign in with your password, or have a one-time link emailed to
        you.
      </p>
      {error && (
        <p role="alert">
          {REASONS[error] ?? 'That link did not work. Request a new one.'}{' '}
          <span className="muted">({error})</span>
        </p>
      )}
      <LoginForm />
    </main>
  );
}
