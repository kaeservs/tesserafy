import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { Icon } from '@/components/icons';
import { LoginForm } from './login-form';
import { signInFailure } from './reasons';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; deleted?: string }>;
}) {
  const { error, deleted } = await searchParams;
  // Said in our words, whatever the address says (./reasons).
  const failure = error ? signInFailure(error) : null;
  const supabase = await createClient();
  const { data: open } = await supabase.rpc('signup_is_open');

  return (
    <main className="auth">
      <div className="auth-card">
      <span className="brand auth-brand">
        <Icon name="logo" size={28} />
        <span>Tesserafy</span>
      </span>
      <h1>Welcome back 👋</h1>
      <p className="muted">
        {open === true ? '' : 'Access is by invitation. '}Sign in with your password, or have a
        one-time link emailed to you.
      </p>
      {deleted === '1' ? (
        <p role="status">
          You have been signed out, and your account is being deleted. Tesserafy deletes the login
          within 30 days, usually much sooner.
        </p>
      ) : null}
      {failure && (
        <p role="alert">
          {failure.message}
          {failure.code ? (
            <>
              {' '}
              <span className="muted">({failure.code})</span>
            </>
          ) : null}
        </p>
      )}
      <LoginForm />
      {open === true ? (
        <p className="muted">
          New to Tesserafy? <Link href="/signup">Create an account</Link>
        </p>
      ) : null}
      </div>
    </main>
  );
}
