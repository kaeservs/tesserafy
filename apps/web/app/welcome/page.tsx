import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

/**
 * Signed in, but not yet part of a company.
 *
 * Sign-up is open by design: a brand creates an account first and pays for a
 * plan second, and the company is created when they do. Between those two
 * steps the account belongs to no company, and every page of the product
 * reads through a company — so without this page the first thing a new
 * customer ever saw was "not a member of any company", as an error.
 *
 * Checkout is not built yet. Until it is, this page says so plainly rather
 * than offering a button that goes nowhere.
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

  return (
    <main style={{ maxWidth: '36rem' }}>
      <h1>Your account is ready</h1>
      <p>
        You are signed in as <strong>{user.email}</strong>. To start importing calls, your company
        needs a plan.
      </p>
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Plans are opening soon</h2>
        <p className="muted" style={{ marginBottom: 0 }}>
          Checkout is not live yet. Your account will be kept, and nothing needs to be done again
          once it is — choosing a plan will create your company and bring you straight in.
        </p>
      </div>
      <form action="/auth/sign-out" method="post">
        <button type="submit">Sign out</button>
      </form>
    </main>
  );
}
