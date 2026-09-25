import { redirect } from 'next/navigation';
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

  const { data: open } = await supabase.rpc('signup_is_open');

  return (
    <main style={{ maxWidth: '36rem' }}>
      <h1>Your account is ready</h1>
      <p>
        You are signed in as <strong>{user.email}</strong>.
      </p>
      {open === true ? (
        <>
          <p>
            Name your company to start a fourteen-day trial: 3 imported calls, 3 “Find insights in
            this call”, 1 “Look for patterns” and 15 live minutes. After that, Basic is $9 a month
            and Pro $20.
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
    </main>
  );
}
