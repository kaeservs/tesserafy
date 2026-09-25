import { PasswordForm } from '@/components/password-form';
import { createClient } from '@/lib/supabase/server';

export const metadata = { title: 'Account · Tesserafy' };

/**
 * The signed-in person's own account.
 *
 * An operator-created account arrives here from its invitation link with no
 * password, and is asked to choose one before anything else; everyone else
 * reaches it from their address in the header, to change theirs.
 */
export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<{ invited?: string }>;
}) {
  const { invited } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: membership } = await supabase
    .from('company_members')
    .select('role, companies(name)')
    .eq('user_id', user?.id ?? '')
    .limit(1)
    .maybeSingle();

  const welcome = invited === '1';

  return (
    <main>
      <h1>{welcome ? `Welcome to Tesserafy` : 'Your account'}</h1>
      <p className="muted">
        Signed in as <strong>{user?.email}</strong>
        {membership?.companies
          ? ` · ${membership.role} of ${membership.companies.name}`
          : ''}
      </p>
      <section aria-labelledby="password-heading" className="card">
        <h2 id="password-heading" style={{ marginTop: 0 }}>
          {welcome ? 'First, choose a password' : 'Password'}
        </h2>
        {welcome ? (
          <p className="muted">
            The link you followed works once. With a password you can sign in again from the sign-in
            page whenever you like.
          </p>
        ) : null}
        <PasswordForm invited={welcome} />
      </section>
    </main>
  );
}
