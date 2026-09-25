import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { SignupForm } from './signup-form';

export const metadata = { title: 'Create an account · Tesserafy' };
export const dynamic = 'force-dynamic';

/**
 * Where a brand signs up — when sign-up is open.
 *
 * The switch is the database's (`signup_is_open`), flipped by an operator, so
 * this page and the function that actually creates a company always agree.
 * Closed, it says so and offers the way in that exists.
 */
export default async function SignupPage() {
  const supabase = await createClient();
  const { data: open } = await supabase.rpc('signup_is_open');

  return (
    <main style={{ maxWidth: '28rem' }}>
      <h1>Create your Tesserafy account</h1>
      {open === true ? (
        <>
          <p className="muted">
            Fourteen days free on the trial, then Basic at $9 or Pro at $20 a month. After you
            confirm your email you will name your company.
          </p>
          <SignupForm />
        </>
      ) : (
        <p>
          Sign-up opens soon. If Tesserafy has set up an account for you, sign in instead.
        </p>
      )}
      <p className="muted">
        Already have an account? <Link href="/login">Sign in</Link>
      </p>
    </main>
  );
}
