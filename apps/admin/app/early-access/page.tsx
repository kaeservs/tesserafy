import Link from 'next/link';
import { requireAdmin } from '@/lib/admin';
import { utc } from '@/lib/time';
import { Chrome } from '../chrome';
import { markInvited, removeEntry } from './actions';

/**
 * Who asked, on the landing page, to be told when Tesserafy opens. The
 * landing page stopped asking on 2026-10-07 (it offers sign-up instead), so
 * the list only shrinks: this is the record of who asked, to invite from.
 * Read as the operator, through RLS. Used only to invite them, as the form
 * promised.
 */
export const dynamic = 'force-dynamic';

const USE: Record<string, string> = { sales: 'Sales', onboarding: 'Onboarding', support: 'Support', other: 'Other' };

export default async function EarlyAccess() {
  const admin = await requireAdmin();
  const { data, error } = await admin.db
    .from('early_access')
    .select('id, email, company, use_case, created_at, invited_at')
    .order('invited_at', { ascending: true, nullsFirst: true })
    .order('created_at', { ascending: false })
    .limit(1000);
  const rows = data ?? [];
  const waiting = rows.filter((row) => !row.invited_at).length;

  return (
    <Chrome email={admin.email}>
      <h1>Early access</h1>
      <p className="lede">
        People who asked on the landing page to be told when Tesserafy opens, while it had that form (it was taken off on 7
        October 2026, so nobody new arrives here). The form promised the address is used only for that. &ldquo;Invite to the beta&rdquo; opens Add people with them on Free; they are marked invited once added, and
        you send the sign-in link it makes.
      </p>
      {error ? <p className="tag open">{error.message}</p> : null}
      <section className="card">
        <p className="muted" style={{ marginTop: 0 }}>
          {rows.length} on the list · {waiting} not yet invited
        </p>
        {rows.length === 0 ? (
          <p className="muted" style={{ marginBottom: 0 }}>Nobody yet.</p>
        ) : (
          <table tabIndex={0}>
            <thead>
              <tr>
                <th>Email</th>
                <th>Company</th>
                <th>For</th>
                <th>Asked</th>
                <th>Invited</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>{row.email}</td>
                  <td className="muted">{row.company ?? '—'}</td>
                  <td className="muted">{row.use_case ? (USE[row.use_case] ?? row.use_case) : '—'}</td>
                  <td className="muted">{utc(row.created_at)}</td>
                  <td>
                    <form action={markInvited} className="row" style={{ alignItems: 'center' }}>
                      <input type="hidden" name="id" value={row.id} />
                      <input type="hidden" name="invited" value={row.invited_at ? 'no' : 'yes'} />
                      <span className={`tag${row.invited_at ? ' admin' : ' open'}`}>{row.invited_at ? 'invited' : 'waiting'}</span>
                      <button type="submit" className="link-button">
                        {row.invited_at ? 'Undo' : 'Mark invited'}
                      </button>
                    </form>
                  </td>
                  <td>
                    <div className="row" style={{ alignItems: 'center' }}>
                      {row.invited_at ? null : (
                        <Link
                          href={`/onboard?${new URLSearchParams({
                            email: row.email,
                            plan: 'free',
                            early: row.id,
                            ...(row.company ? { company: row.company } : {}),
                          }).toString()}`}
                        >
                          Invite to the beta
                        </Link>
                      )}
                      <form action={removeEntry}>
                        <input type="hidden" name="id" value={row.id} />
                        <button type="submit" className="danger">
                          Remove
                        </button>
                      </form>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </Chrome>
  );
}
