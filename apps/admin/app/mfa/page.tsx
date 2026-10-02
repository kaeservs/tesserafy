import { redirect } from 'next/navigation';
import { requireOperatorMember } from '@/lib/admin';
import { signOut } from '../actions';
import { EnrolForm, VerifyForm } from './form';

/**
 * The second step, for operators.
 *
 * With an authenticator: the code, every sign-in. Without one: setting it up.
 * Reached before the console opens, so it uses no admin function — the
 * database may not count this session as an operator's until the code is in.
 */
export const dynamic = 'force-dynamic';

export default async function Mfa() {
  const { db, email } = await requireOperatorMember();
  const { data: factors } = await db.auth.mfa.listFactors();
  const verified = (factors?.totp ?? []).find((factor) => factor.status === 'verified');
  // Already through the second step this session: nothing to ask.
  const { data: level } = await db.auth.mfa.getAuthenticatorAssuranceLevel();
  if (verified && level?.currentLevel === 'aal2') redirect('/');

  return (
    <main className="auth">
      <div className="auth-card" style={{ width: 'min(100%, 34rem)' }}>
      <h1>{verified ? 'Your code, please' : 'Set up two-step sign-in'}</h1>
      <p className="lede">
        {verified
          ? `Signed in as ${email}. The console asks for a code from your authenticator every time, because it can open any customer's account.`
          : `Signed in as ${email}. This console can open any customer's account, so it asks for more than a password: a code from an app on your phone. Setting it up takes a minute.`}
      </p>
      {verified ? <VerifyForm factorId={verified.id} /> : <EnrolForm />}
      <form action={signOut} style={{ marginTop: '2rem' }}>
        <button type="submit">Sign out</button>
      </form>
      </div>
    </main>
  );
}
