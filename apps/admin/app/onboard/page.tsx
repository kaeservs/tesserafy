import { requireAdmin } from '@/lib/admin';
import { listCompanies } from '@/lib/companies';
import { utc } from '@/lib/time';
import { Chrome } from '../chrome';
import { ProvisionForm } from './form';
import { RequestsPanel } from './request-actions';

/**
 * Onboarding a pilot customer, until checkout does it.
 *
 * Every addition is recorded before the account exists, and the log below is
 * that record: who added whom, to what, and whether it finished. An open row
 * is an attempt that stopped part-way, and is shown as one.
 */
export const dynamic = 'force-dynamic';

export default async function Onboard() {
  const admin = await requireAdmin();
  const [{ companies }, { data: log, error }, { data: requests }] = await Promise.all([
    // Through admin_companies, not the table: an operator is not a member of
    // the companies they look after, so RLS would show them none.
    listCompanies(admin.db),
    admin.db
      .from('account_provisioning')
      .select('id, email, role, company_name, company_id, created_at, completed_at, new_account')
      .order('created_at', { ascending: false })
      .limit(25),
    admin.db.rpc('admin_access_requests'),
  ]);

  const names = new Map(companies.map((c) => [c.companyId, c.name]));

  return (
    <Chrome email={admin.email}>
      <h1>Add people</h1>
      <p className="lede">
        Create a company with its first owner, or add someone to a company that exists. You get a
        one-time link to send them yourself. One company per person: someone already in one is
        refused.
      </p>

      {/*
        What owners have asked for, first: someone is waiting on each. Always
        rendered, even with nothing waiting, so the panel — and a link it is
        showing — survives the refresh that answering causes.
      */}
      <RequestsPanel
        requests={(requests ?? []).map((request) => ({
          id: request.id,
          companyId: request.company_id,
          companyName: request.company_name,
          email: request.email,
          role: request.role,
          note: request.note,
          requestedBy: request.requested_by,
          asked: utc(request.created_at),
        }))}
      />

      <ProvisionForm
        // A closed company cannot take anyone; the database would refuse.
        companies={companies
          .filter((c) => !c.closedAt)
          .map((c) => ({ id: c.companyId, name: c.name }))
          .sort((a, b) => a.name.localeCompare(b.name))}
      />

      <h2>Recent</h2>
      {error ? <p className="tag open">{error.message}</p> : null}
      <table>
        <thead>
          <tr>
            <th>When</th>
            <th>Email</th>
            <th>Company</th>
            <th>Role</th>
            <th>Outcome</th>
          </tr>
        </thead>
        <tbody>
          {(log ?? []).map((row) => (
            <tr key={row.id}>
              <td className="muted">{utc(row.created_at)}</td>
              <td>{row.email}</td>
              <td>
                {row.company_id ? (names.get(row.company_id) ?? row.company_id) : row.company_name}
              </td>
              <td>{row.role}</td>
              <td>
                {row.completed_at ? (
                  <span className="tag">{row.new_account ? 'new account' : 'existing account'}</span>
                ) : (
                  <span className="tag open">did not finish</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {(log ?? []).length === 0 && !error ? <p className="muted">Nobody added yet.</p> : null}
    </Chrome>
  );
}
