import Link from 'next/link';
import { requireAdmin } from '@/lib/admin';
import { Chrome } from '../chrome';
import { RequireSwitch } from './switch';

/**
 * Two-step sign-in for operators: who has an authenticator, and whether the
 * database requires one.
 *
 * Required means an operator's password alone opens nothing — not the console,
 * not an admin function called directly, not another company's rows through
 * the web app. The switch refuses to turn on while anyone would be locked out,
 * and needs your own code to move either way.
 */
export const dynamic = 'force-dynamic';

interface Status {
  required: boolean;
  your_level: string;
  operators: { email: string; you: boolean; has_factor: boolean }[];
}

export default async function Security() {
  const admin = await requireAdmin();
  const { data, error } = await admin.db.rpc('admin_operator_mfa');
  const status = data as unknown as Status | null;
  const youHaveOne = status?.operators.some((operator) => operator.you && operator.has_factor) ?? false;
  const everyoneHasOne = status?.operators.every((operator) => operator.has_factor) ?? false;

  return (
    <Chrome email={admin.email}>
      <h1>Security</h1>
      <p className="lede">
        This console can open any customer&apos;s account. With two-step sign-in required, a stolen operator
        password opens nothing: the database itself asks for the code, not only this page.
      </p>
      {error ? <p className="tag open">{error.message}</p> : null}

      {status ? (
        <>
          <section className="card" style={{ marginBottom: '1rem' }}>
            <h2 style={{ marginTop: 0 }}>Required for every operator</h2>
            <p>
              <span className={`tag${status.required ? '' : ' open'}`}>{status.required ? 'on' : 'off'}</span>{' '}
              {status.required
                ? 'An operator signs in with a password and a code from their authenticator.'
                : 'Operators can sign in with a password alone. Turn this on once everyone below has an authenticator.'}
            </p>
            {!youHaveOne ? (
              <p>
                <Link className="link" href="/mfa">
                  Set up your authenticator first →
                </Link>
              </p>
            ) : status.your_level !== 'aal2' ? (
              <p className="muted">Sign out and in again with your code to change this.</p>
            ) : (
              <RequireSwitch required={status.required} ready={everyoneHasOne} />
            )}
          </section>

          <table>
            <thead>
              <tr>
                <th>Operator</th>
                <th>Authenticator</th>
              </tr>
            </thead>
            <tbody>
              {status.operators.map((operator) => (
                <tr key={operator.email}>
                  <td>
                    {operator.email}
                    {operator.you ? <span className="muted"> (you)</span> : null}
                  </td>
                  <td>
                    {operator.has_factor ? (
                      <span className="tag">set up</span>
                    ) : (
                      <span className="tag open">not yet</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted">
            Lost a phone? An operator without their authenticator is removed from it in the Supabase dashboard
            (Authentication → the user → remove factor), then sets up a new one here.
          </p>
        </>
      ) : null}
    </Chrome>
  );
}
