import Link from 'next/link';
import { AddAccount } from '@/components/account-forms';
import { listAccounts } from '@/lib/accounts';
import { OUTCOME_LABEL } from '@/lib/outcome';
import { createClient } from '@/lib/supabase/server';

export const metadata = { title: 'Accounts · Tesserafy' };

function day(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { dateStyle: 'medium', timeZone: 'UTC' });
}

/**
 * The customers the company's calls are with, most recently spoken to first.
 * An account is named from a call (import it, or Edit this call) or here, ahead
 * of a first call, so there is a brief to read before it.
 */
export default async function AccountsPage() {
  const supabase = await createClient();
  const accounts = (await listAccounts(supabase)).sort(
    (a, b) => (b.lastCallAt ?? '').localeCompare(a.lastCallAt ?? '') || a.name.localeCompare(b.name),
  );

  return (
    <main>
      <h1>Accounts</h1>
      <p className="muted">
        The customers your calls are with. Open one for every call with them, how the latest ended, and what they
        have said across all of them.
      </p>
      <AddAccount />

      {accounts.length === 0 ? (
        <p className="muted">
          None yet. Say who a call was with when you import it, or under Edit this call on any call.
        </p>
      ) : (
        <table className="team">
          <thead>
            <tr>
              <th scope="col">Customer</th>
              <th scope="col">Calls</th>
              <th scope="col">Last call</th>
              <th scope="col">Where it stands</th>
            </tr>
          </thead>
          <tbody>
            {accounts.map((account) => (
              <tr key={account.id}>
                <td>
                  <Link href={`/accounts/${account.id}`}>{account.name}</Link>
                  {account.domain ? <span className="muted"> · {account.domain}</span> : null}
                </td>
                <td>{account.calls}</td>
                <td className="when">{account.lastCallAt ? day(account.lastCallAt) : <span className="muted">none yet</span>}</td>
                <td>
                  {account.latestOutcome ? (
                    <span className={`stage outcome-${account.latestOutcome}`}>{OUTCOME_LABEL[account.latestOutcome]}</span>
                  ) : (
                    <span className="muted">not said</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
