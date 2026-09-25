/**
 * Who has opened this call, for its company's owner.
 *
 * Folded away: it is an audit answer, looked for when someone asks, not
 * something to read past every time. A visit made while a support session was
 * open says so — that session is genuinely the customer's account, so without
 * the note a staff visit would read here as their own.
 */
export interface Viewer {
  email: string;
  lastViewedAt: string;
  views: number;
  duringSupport: boolean;
}

function when(iso: string): string {
  // Rendered on the server, whose clock is UTC; say so.
  return `${new Date(iso).toISOString().replace('T', ' ').slice(0, 16)} UTC`;
}

export function CallViewers({ viewers }: { viewers: Viewer[] }) {
  return (
    <section aria-labelledby="viewers-heading" className="card">
      <details>
        <summary>
          <h2 id="viewers-heading" style={{ display: 'inline', fontSize: '1rem' }}>
            Who has opened this call
          </h2>{' '}
          <span className="muted">
            ({viewers.length} {viewers.length === 1 ? 'person' : 'people'})
          </span>
        </summary>
        <table className="team" style={{ marginTop: '0.75rem' }}>
          <thead>
            <tr>
              <th>Person</th>
              <th>Last opened</th>
              <th>Visits</th>
            </tr>
          </thead>
          <tbody>
            {viewers.map((viewer) => (
              <tr key={viewer.email}>
                <td>
                  {viewer.email}
                  {viewer.duringSupport ? (
                    <span className="muted"> — includes visits during a Tesserafy support session</span>
                  ) : null}
                </td>
                <td className="muted when">{when(viewer.lastViewedAt)}</td>
                <td className="muted">{viewer.views}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted" style={{ marginBottom: 0 }}>
          Opening this page is recorded, once per person every ten minutes. Search results and
          insight quotes are not. Only owners can see this.
        </p>
      </details>
    </section>
  );
}
