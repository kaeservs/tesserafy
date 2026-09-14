import { LoginForm } from './login-form';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <main>
      <h1>Sign in to Tesserafy</h1>
      <p className="muted">Access is by invitation. We will email you a one-time link.</p>
      {error && (
        <p role="alert">That link was invalid or has expired. Request a new one.</p>
      )}
      <LoginForm />
    </main>
  );
}
