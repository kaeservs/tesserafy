import { TableScroll } from '@/components/table-scroll';
import Link from 'next/link';
import { AddAccount } from '@/components/account-forms';
import { listAccounts } from '@/lib/accounts';
import { accountsNeedingAttention, LOW_SCORE, QUIET_DEAL_DAYS } from '@/lib/accounts-attention';
import { loadCoachingCalls } from '@/lib/coaching-data';
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
  const [listed, calls] = await Promise.all([listAccounts(supabase), loadCoachingCalls(supabase)]);
  const accounts = listed.sort(
    (a, b) => (b.lastCallAt ?? '').localeCompare(a.lastCallAt ?? '') || a.name.localeCompare(b.name),
  );
  // Each customer's newest call, and how it scored.
  const newest = new Map<string, { date: string; score: number | null }>();
  for (const call of calls) {
    if (!call.accountId) continue;
    const seen = newest.get(call.accountId);
    if (!seen || call.date > seen.date) newest.set(call.accountId, { date: call.date, score: call.score });
  }
  const attention = accountsNeedingAttention(
    accounts.map((account) => ({ ...account, lastScore: newest.get(account.id)?.score ?? null })),
    new Date(),
  );

  return (
    <main>
      <h1>Accounts</h1>
      <p className="muted">
        The customers your calls are with. Open one for every call with them, how the latest ended, and what they
        have said across all of them.
      </p>
      <AddAccount />

      {attention.length > 0 ? (
        <section aria-labelledby="attention-heading" className="card" style={{ marginBottom: '1rem' }}>
          <h2 id="attention-heading" style={{ marginTop: 0 }}>
            Need attention
          </h2>
          <ul className="evidence" style={{ marginBottom: 0 }}>
            {attention.map((account) => (
              <li key={account.id}>
                <Link href={`/accounts/${account.id}`}>{account.name}</Link>{' '}
                <span className="muted">
                  —{' '}
                  {account.reasons
                    .map((reason) =>
                      reason === 'quiet'
                        ? `deal still open, no call since ${account.lastCallAt ? day(account.lastCallAt) : 'ever'}`
                        : `last call scored ${Math.round(account.lastScore ?? 0)}`,
                    )
                    .join('; ')}
                </span>
              </li>
            ))}
          </ul>
          <p className="muted" style={{ marginBottom: 0, fontSize: '0.82rem' }}>
            An open deal with no call for {QUIET_DEAL_DAYS}+ days, or a last call scoring under {LOW_SCORE} on a deal not yet
            won or lost.
          </p>
        </section>
      ) : null}

      {accounts.length === 0 ? (
        <p className="muted">
          None yet. Say who a call was with when you import it, or under Edit this call on any call.
        </p>
      ) : (
        <TableScroll label="Accounts">
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
        </TableScroll>
      )}
    </main>
  );
}
