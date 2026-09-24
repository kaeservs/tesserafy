import { requireAdmin } from '@/lib/admin';
import { Chrome } from './chrome';
import { OpenSession } from './open-session';

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

function ago(iso: string | null): string {
  if (!iso) return 'never';
  // Clamped at zero. A timestamp can sit a moment in the future — the
  // server's clock against this one, or, in the support tool, the sign-in
  // this very command just performed — and an unclamped floor renders that
  // as "-1d ago", which reads like a bug in the data rather than in the
  // arithmetic.
  const days = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000));
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  return `${days}d ago`;
}

export default async function People() {
  const admin = await requireAdmin();
  const { data, error } = await admin.db.rpc('admin_users');
  const users = data ?? [];

  return (
    <Chrome email={admin.email}>
      <h1>People</h1>
      <p className="lede">
        Every account, across every company. Opening a session as someone writes a record first —
        who, whom, why and for how long — and that record is visible to them.
      </p>

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
            </tr>
          ))}
        </tbody>
      </table>

      {users.length === 0 && !error ? <p className="muted">No accounts yet.</p> : null}
    </Chrome>
  );
}
