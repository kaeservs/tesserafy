import Link from 'next/link';
import { DeleteMyAccount } from '@/components/delete-my-account';
import { myMembership } from '@/lib/membership';
import { createClient } from '@/lib/supabase/server';

export const metadata = { title: 'Delete account · Tesserafy' };

/**
 * Deleting your own account (ADR 0013). A company needs an owner, so an owner
 * is told how to step down first; anyone else can delete it here.
 */
export default async function DeleteAccountPage() {
  const supabase = await createClient();
  const { user, role, company } = await myMembership(supabase);

  return (
    <section aria-labelledby="delete-account-heading" className="card">
      <h2 id="delete-account-heading" style={{ marginTop: 0 }}>
        Delete your account
      </h2>
      {role === 'owner' ? (
        <p className="muted" style={{ marginBottom: 0 }}>
          You own {company?.name ?? 'your company'}, and a company needs an owner. To delete your account, first make someone
          else an owner and step down to member, under <Link href="/settings/team">Settings → Team</Link>; then this page
          offers it. If you are the only person in the company, ask Tesserafy to close it instead, which deletes its calls.
        </p>
      ) : (
        <DeleteMyAccount email={user?.email ?? ''} company={company?.name ?? null} />
      )}
    </section>
  );
}
