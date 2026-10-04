import { requireAdmin } from '@/lib/admin';
import { behind, newestOverlayVersion, PLATFORM } from '@/lib/overlay-release';
import { utc } from '@/lib/time';
import { Chrome } from '../chrome';

/**
 * Who runs which overlay. An overlay older than a server change may not work
 * (one before 0.1.14 cannot make the recording agreement, so cannot start a
 * call), so the people behind the newest release are listed first. Recorded
 * when the overlay reads its setup; overlays before 0.1.15 do not say.
 */
export const dynamic = 'force-dynamic';

export default async function Overlays() {
  const admin = await requireAdmin();
  const [{ data, error }, newest] = await Promise.all([admin.db.rpc('admin_overlay_seen'), newestOverlayVersion()]);
  const rows = (data ?? []).map((row) => ({ ...row, behind: behind(row.version, newest) }));
  rows.sort((a, b) => Number(b.behind) - Number(a.behind) || b.seen_at.localeCompare(a.seen_at));
  const behindCount = rows.filter((row) => row.behind).length;

  return (
    <Chrome email={admin.email}>
      <h1>Overlays</h1>
      <p className="lede">
        Which version each person runs, as their overlay said when it last read its setup.
        {newest ? ` The newest release is ${newest}.` : ' The newest release could not be read from GitHub just now.'} Overlays
        before 0.1.15 do not report a version.
      </p>
      {error ? <p className="tag open">{error.message}</p> : null}
      <section className="card">
        <p className="muted" style={{ marginTop: 0 }}>
          {rows.length} {rows.length === 1 ? 'person' : 'people'}
          {newest ? ` · ${behindCount} behind ${newest}` : ''}
        </p>
        {rows.length === 0 ? (
          <p className="muted" style={{ marginBottom: 0 }}>No overlay has reported a version yet.</p>
        ) : (
          <table tabIndex={0}>
            <thead>
              <tr>
                <th>Person</th>
                <th>Company</th>
                <th>Platform</th>
                <th>Version</th>
                <th>Last seen</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={`${row.email}-${row.platform}`}>
                  <td>{row.email}</td>
                  <td className="muted">{row.company ?? 'no company'}</td>
                  <td className="muted">{PLATFORM[row.platform] ?? row.platform}</td>
                  <td>
                    {row.version}{' '}
                    {newest ? (
                      <span className={`tag${row.behind ? ' open' : ' admin'}`}>{row.behind ? 'update' : 'newest'}</span>
                    ) : null}
                  </td>
                  <td className="muted">{utc(row.seen_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </Chrome>
  );
}
