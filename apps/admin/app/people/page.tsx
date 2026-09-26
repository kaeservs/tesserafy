import { requireAdmin } from '@/lib/admin';
import { deletable } from '@/lib/people';
import { ago, utc } from '@/lib/time';
import { Chrome } from '../chrome';
import { OpenSession } from '../open-session';

/**
 * Everyone who has an account, and the button that is the reason this app
 * exists.
 *
 * The list comes from `admin_users()`, which checks `is_platform_admin()`
 * itself. This page checking as well is not belt and braces for its own sake:
 * the page check decides what you see, and the function check decides what the
 * database will answer. Only the second one matters, and it is the one nobody
 * can forget to call.
 */
export const dynamic = 'force-dynamic';

export default async function People({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; all?: string }>;
}) {
  const { q = '', all } = await searchParams;
  const admin = await requireAdmin();
  const [{ data, error }, { data: deletions }] = await Promise.all([
    admin.db.rpc('admin_users'),
    admin.db
      .from('account_deletions')
      .select('id, admin_user_id, reason, created_at, completed_at')
      .order('created_at', { ascending: false })
      .limit(50),
  ]);
  const everyone = data ?? [];
  const emailOf = new Map(everyone.map((user) => [user.user_id, user.email ?? '—']));
  const deletableWithoutCompany = everyone.filter((user) => deletable(user, admin.userId)).length;
  // Accounts in no company are mostly people removed, or companies closed —
  // and, today, the synthetic accounts the checks leave behind. Hidden unless
  // asked for, so the list is the people who can see something.
  const withoutCompany = everyone.filter((user) => !user.company_id).length;
  const needle = q.trim().toLowerCase();
  const users = everyone.filter(
    (user) =>
      (all === '1' || user.company_id || user.is_admin) &&
      (!needle ||
        (user.email ?? '').toLowerCase().includes(needle) ||
        (user.company_name ?? '').toLowerCase().includes(needle)),
  );

  return (
    <Chrome email={admin.email}>
      <h1>People</h1>
      <p className="lede">
        Every account, across every company. Opening a session as someone writes a record first —
        who, whom, why and for how long — and that record is visible to them.
      </p>

      <form className="row" style={{ marginBottom: '1rem' }}>
        <div>
          <label htmlFor="q">Find by email or company</label>
          <input id="q" name="q" defaultValue={q} placeholder="acme, priya@" />
        </div>
        {all === '1' ? <input type="hidden" name="all" value="1" /> : null}
        <div className="go">
          <button type="submit">Search</button>
        </div>
        <div className="go">
          {all === '1' ? (
            <>
              <a className="link" href={`/people${q ? `?q=${encodeURIComponent(q)}` : ''}`}>
                Hide the {withoutCompany} with no company
              </a>
              {deletableWithoutCompany > 0 ? (
                <>
                  {' · '}
                  <a className="link" href="/people/delete?all=1">
                    Delete accounts with no company…
                  </a>
                </>
              ) : null}
            </>
          ) : (
            <a className="link" href={`/people?all=1${q ? `&q=${encodeURIComponent(q)}` : ''}`}>
              Show the {withoutCompany} with no company
            </a>
          )}
        </div>
      </form>

      {error ? <p className="tag open">{error.message}</p> : null}

      <table>
        <thead>
          <tr>
            <th>Email</th>
            <th>Company</th>
            <th>Role</th>
            <th>Last seen</th>
            <th>Joined</th>
            <th>Open a session</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {users.map((user) => (
            <tr key={user.user_id}>
              <td>
                {user.email}{' '}
                {user.is_admin ? <span className="tag admin">operator</span> : null}{' '}
                {user.open_support ? <span className="tag open">session open</span> : null}
              </td>
              <td>{user.company_name ?? <span className="muted">no company</span>}</td>
              <td className="muted">{user.role ?? '—'}</td>
              <td className="muted">{ago(user.last_sign_in)}</td>
              <td className="muted">{ago(user.created_at)}</td>
              <td>
                {user.user_id === admin.userId ? (
                  <span className="muted">that is you</span>
                ) : (
                  <OpenSession subjectId={user.user_id} email={user.email ?? ''} />
                )}
              </td>
              <td>
                {deletable(user, admin.userId) ? (
                  <a className="link" href={`/people/delete?ids=${user.user_id}`}>
                    Delete…
                  </a>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {users.length === 0 && !error ? <p className="muted">Nobody matches.</p> : null}

      {(deletions ?? []).length > 0 ? (
        <section aria-labelledby="deleted-heading">
          <h2 id="deleted-heading">Deleted accounts</h2>
          <p className="muted">
            Who deleted an account, when and why. The address is not kept, only a fingerprint of it.
          </p>
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>By</th>
                <th>Reason</th>
                <th>State</th>
              </tr>
            </thead>
            <tbody>
              {(deletions ?? []).map((row) => (
                <tr key={row.id}>
                  <td className="muted">{utc(row.created_at)}</td>
                  <td>{emailOf.get(row.admin_user_id) ?? 'a former operator'}</td>
                  <td>{row.reason}</td>
                  <td>
                    {row.completed_at ? (
                      <span className="muted">deleted</span>
                    ) : (
                      <span className="tag open">did not finish</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}
    </Chrome>
  );
}
