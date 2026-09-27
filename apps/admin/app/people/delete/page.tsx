import { requireAdmin } from '@/lib/admin';
import { deletable } from '@/lib/people';
import { ago } from '@/lib/time';
import { Chrome } from '../../chrome';
import { DeleteForm, type Candidate } from './form';

/**
 * Delete one account, or several with no company.
 *
 * `?ids=` names the accounts (one, from a row on People); `?all=1` offers
 * every account the database would let go — no company, not an operator's,
 * no support session open — each ticked, to be unticked as needed. An account
 * named that cannot be deleted here is listed with the reason, rather than
 * silently left out.
 */
export const dynamic = 'force-dynamic';

export default async function DeletePeople({
  searchParams,
}: {
  searchParams: Promise<{ ids?: string; all?: string; requested?: string }>;
}) {
  const { ids = '', all, requested } = await searchParams;
  const admin = await requireAdmin();
  const { data, error } = await admin.db.rpc('admin_users');
  const everyone = data ?? [];

  const named = new Set(ids.split(',').filter(Boolean));
  const asked = all === '1' ? everyone.filter((user) => !user.company_id) : everyone.filter((user) => named.has(user.user_id));
  const candidates: Candidate[] = asked
    .filter((user) => deletable(user, admin.userId))
    .map((user) => ({
      userId: user.user_id,
      email: user.email ?? user.user_id,
      joined: ago(user.created_at),
      lastSeen: ago(user.last_sign_in),
    }));
  const blocked = asked.filter((user) => !deletable(user, admin.userId));

  const why = (user: (typeof asked)[number]) =>
    user.user_id === admin.userId
      ? 'that is you'
      : user.is_admin
        ? 'an operator'
        : user.company_id
          ? `in ${user.company_name ?? 'a company'} — they leave it first, or it is closed`
          : 'a support session is open on it';

  return (
    <Chrome email={admin.email}>
      <p>
        <a className="link" href="/people?all=1">
          ← People
        </a>
      </p>
      <h1>Delete accounts</h1>
      <p className="lede">
        Deletes the login: the address, the password and every session. It cannot be undone.
      </p>
      <p className="muted">
        What stays: calls they added stay with their company, no longer attributed to anyone; the
        access history and other audit records keep the account&apos;s id, which no longer leads
        to anybody; and a record of this deletion — who, when and why — with a fingerprint of the
        address in place of the address. Only accounts in no company can be deleted, so no team
        loses a member here.
      </p>

      {error ? <p className="tag open">{error.message}</p> : null}

      <DeleteForm
        candidates={candidates}
        defaultReason={requested === '1' ? 'the account holder asked for it to be deleted' : ''}
      />

      {blocked.length > 0 ? (
        <section aria-labelledby="blocked-heading">
          <h2 id="blocked-heading">Not deleted here</h2>
          <ul>
            {blocked.map((user) => (
              <li key={user.user_id}>
                {user.email} <span className="muted">— {why(user)}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </Chrome>
  );
}
