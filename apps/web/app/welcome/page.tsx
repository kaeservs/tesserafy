import { redirect } from 'next/navigation';
import { DeleteMyAccount } from '@/components/delete-my-account';
import { createClient } from '@/lib/supabase/server';
import { CreateCompany } from './create-company';

/**
 * Signed in, but not yet part of a company.
 *
 * Sign-up is open by design: a brand creates an account first and pays for a
 * plan second, and the company is created when they do. Between those two
 * steps the account belongs to no company, and every page of the product
 * reads through a company — so without this page the first thing a new
 * customer ever saw was "not a member of any company", as an error.
 *
 * With sign-up open (an operator's switch, in the database), this is where a
 * confirmed account names its company and its trial starts. Closed, it says
 * so rather than offering a button that the database would refuse.
 */
export const dynamic = 'force-dynamic';

export default async function Welcome() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  // Someone who does have a company has no business here.
  const { count } = await supabase
    .from('company_members')
    .select('company_id', { count: 'exact', head: true })
    .eq('user_id', user.id);
  if ((count ?? 0) > 0) redirect('/dashboard');

  const [{ data: open }, { data: deletion }] = await Promise.all([
    supabase.rpc('signup_is_open'),
    supabase
      .from('account_deletion_requests')
      .select('requested_at')
      .is('resolved_at', null)
      .maybeSingle(),
  ]);

  // Asked to be deleted: that is the whole story now, not an invitation to
  // start a company.
  if (deletion) {
    return (
      <main style={{ maxWidth: '36rem' }}>
        <h1>Your account is being deleted</h1>
        <p>
          You asked on{' '}
          {new Date(deletion.requested_at).toLocaleDateString('en-GB', {
            day: 'numeric',
            month: 'long',
            year: 'numeric',
            timeZone: 'UTC',
          })}{' '}
          for <strong>{user.email}</strong> to be deleted. Tesserafy deletes the login — your address
          and password — within 30 days of that, usually much sooner. There is nothing else to do.
        </p>
        <form action="/auth/sign-out" method="post">
          <button type="submit">Sign out</button>
        </form>
      </main>
    );
  }

  return (
    <main style={{ maxWidth: '36rem' }}>
      <h1>Your account is ready</h1>
      <p>
        You are signed in as <strong>{user.email}</strong>.
      </p>
      {open === true ? (
        <>
          <p>
            Name your company to start on Free: one seat, and each month 2 imported calls, 1 “Find
            insights in this call”, 5 questions to Ask and 10 live minutes. Starter is $9.99, Pro $19.99 and
            Incognito $59.99 a seat a month.
          </p>
          <CreateCompany />
        </>
      ) : (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>You are not part of a company yet</h2>
          <p className="muted" style={{ marginBottom: 0 }}>
            Sign-up is not open yet. If you expected to be part of a company, ask its owner to add
            you — or Tesserafy, if you are setting one up.
          </p>
        </div>
      )}
      <form action="/auth/sign-out" method="post">
        <button type="submit">Sign out</button>
      </form>
      <section aria-labelledby="delete-account-heading" className="card" style={{ marginTop: '2rem' }}>
        <h2 id="delete-account-heading" style={{ marginTop: 0 }}>
          Delete your account
        </h2>
        <DeleteMyAccount email={user.email ?? ''} company={null} />
      </section>
    </main>
  );
}
