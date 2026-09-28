import { requireAdmin } from '@/lib/admin';
import { utc } from '@/lib/time';
import { Chrome } from '../chrome';

/**
 * Everything operators have done, in one list.
 *
 * Opening an account, provisioning or deleting one, setting a plan, closing a
 * company, answering a teammate request, changing a role, flipping signup —
 * each already writes its own record; admin_activity() reads them together so
 * "what did we do this week" is one page, not seven. Access history keeps the
 * fuller detail of support sessions.
 */
export const dynamic = 'force-dynamic';

export default async function Activity({ searchParams }: { searchParams: Promise<{ who?: string; what?: string }> }) {
  const { who, what } = await searchParams;
  const admin = await requireAdmin();
  const { data, error } = await admin.db.rpc('admin_activity', { p_limit: 500 });
  const all = (data ?? []).map((row) => ({
    at: row.at,
    actor: row.actor,
    action: row.action,
    subject: row.subject,
    // Nullable in fact; the generated types cannot say so.
    detail: (row.detail as string | null) ?? null,
  }));
  const actors = [...new Set(all.map((row) => row.actor))].sort();
  const actions = [...new Set(all.map((row) => row.action))].sort();
  const rows = all.filter((row) => (!who || row.actor === who) && (!what || row.action === what));

  return (
    <Chrome email={admin.email}>
      <h1>Operator activity</h1>
      <p className="lede">
        What operators have done, newest first — the last 500 actions. Every entry comes from a record
        the action itself wrote.
      </p>
      {error ? <p className="tag open">{error.message}</p> : null}

      <form method="get" className="row" style={{ alignItems: 'end', marginBottom: '1rem' }}>
        <label>
          Who
          <select name="who" defaultValue={who ?? ''}>
            <option value="">Anyone</option>
            {actors.map((actor) => (
              <option key={actor} value={actor}>
                {actor}
              </option>
            ))}
          </select>
        </label>
        <label>
          What
          <select name="what" defaultValue={what ?? ''}>
            <option value="">Anything</option>
            {actions.map((action) => (
              <option key={action} value={action}>
                {action}
              </option>
            ))}
          </select>
        </label>
        <button type="submit">Show</button>
      </form>

      <table>
        <thead>
          <tr>
            <th>When</th>
            <th>Who</th>
            <th>Did</th>
            <th>To</th>
            <th>Detail</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={`${row.at}-${index}`}>
              <td className="muted">{utc(row.at)}</td>
              <td>{row.actor}</td>
              <td>{row.action}</td>
              <td>{row.subject}</td>
              <td className="muted">{row.detail ?? ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 && !error ? <p className="muted">Nothing matches.</p> : null}
    </Chrome>
  );
}
