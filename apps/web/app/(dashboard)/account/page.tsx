import { NameForm } from '@/components/name-form';
import { PasswordForm } from '@/components/password-form';
import { myMembership } from '@/lib/membership';
import { createClient } from '@/lib/supabase/server';

export const metadata = { title: 'Account · Tesserafy' };

/**
 * Who you are: your name and your password.
 *
 * An operator-created account arrives here from its invitation link with no
 * password, and is asked to choose one before anything else; everyone else
 * reaches it from their name in the sidebar, to change theirs.
 */
export default async function AccountPage({ searchParams }: { searchParams: Promise<{ invited?: string }> }) {
  const { invited } = await searchParams;
  const supabase = await createClient();
  const { user, role, company } = await myMembership(supabase);
  const welcome = invited === '1';
  const { data: preferences } = await supabase
    .from('user_preferences')
    .select('display_name')
    .eq('user_id', user?.id ?? '')
    .maybeSingle();

  return (
    <>
      <p className="muted">
        {welcome ? <strong>Welcome to Tesserafy. </strong> : null}
        Signed in as <strong>{user?.email}</strong>
        {company ? ` · ${role === 'owner' ? 'Owner' : 'Member'} of ${company.name}` : ''}
      </p>
      <section aria-labelledby="password-heading" className="card">
        <h2 id="password-heading" style={{ marginTop: 0 }}>
          {welcome ? 'First, choose a password' : 'Password'}
        </h2>
        {welcome ? (
          <p className="muted">
            The link you followed works once. With a password you can sign in again from the sign-in page whenever you like.
          </p>
        ) : null}
        <PasswordForm invited={welcome} />
      </section>
      {welcome ? null : (
        <section aria-labelledby="you-heading" className="card">
          <h2 id="you-heading" style={{ marginTop: 0 }}>
            Your name
          </h2>
          <NameForm name={preferences?.display_name ?? ''} />
          <p className="muted" style={{ marginBottom: 0 }}>
            Shown in Tesserafy, and the name your follow-up emails go out under unless you type another.
          </p>
        </section>
      )}
    </>
  );
}
