import { requireAdmin } from '@/lib/admin';
import { endSession } from '../actions';
import { Chrome } from '../chrome';

/**
 * Every time a member of staff opened somebody's account.
 *
 * This page is the product of the whole feature. The impersonation itself was
 * always possible for anyone with the service-role key; this list is the part
 * that did not exist. It is append-only and survives erasure, because the fact
 * that we looked is a record a customer may one day need against us.
 */
export const dynamic = 'force-dynamic';

function when(iso: string): string {
  return new Date(iso).toISOString().replace('T', ' ').slice(0, 16);
}

export default async function History() {
  const admin = await requireAdmin();

  const [{ data: rows, error }, { data: users }] = await Promise.all([
    admin.db
      .from('support_access')
      .select('id, admin_user_id, subject_user_id, reason, created_at, expires_at, ended_at')
      .order('created_at', { ascending: false })
      .limit(200),
    admin.db.rpc('admin_users'),
  ]);

  const emailOf = new Map((users ?? []).map((user) => [user.user_id, user.email ?? '—']));
  const access = rows ?? [];

  return (
    <Chrome email={admin.email}>
      <h1>Access history</h1>
      <p className="lede">
        Every support session ever opened. Never deleted, and visible to the person whose account
        was opened. An audit trail the audited cannot read is a private diary.
      </p>

      {error ? <p className="tag open">{error.message}</p> : null}

      <table>
        <thead>
          <tr>
            <th>Opened</th>
            <th>By</th>
            <th>Into</th>
            <th>Reason</th>
            <th>State</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {access.map((row) => {
            const live = !row.ended_at && new Date(row.expires_at) > new Date();
            return (
              <tr key={row.id}>
                <td className="muted">{when(row.created_at)}</td>
                <td>{emailOf.get(row.admin_user_id) ?? row.admin_user_id}</td>
                <td>{emailOf.get(row.subject_user_id) ?? row.subject_user_id}</td>
                <td>{row.reason}</td>
                <td>
                  {live ? (
                    <span className="tag open">open until {when(row.expires_at)}</span>
                  ) : (
                    <span className="muted">{row.ended_at ? 'ended' : 'expired'}</span>
                  )}
                </td>
                <td>
                  {live && row.admin_user_id === admin.userId ? (
                    <form action={endSession}>
                      <input type="hidden" name="id" value={row.id} />
                      <button type="submit">End now</button>
                    </form>
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {access.length === 0 && !error ? (
        <p className="muted">Nobody has opened anybody. That is the expected state.</p>
      ) : null}
    </Chrome>
  );
}
