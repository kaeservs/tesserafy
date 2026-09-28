import Link from 'next/link';
import { COMPANY_SORTS, findCompanies, type CompanySort } from '@tesserafy/db';
import { requireAdmin } from '@/lib/admin';
import { listCompanies } from '@/lib/companies';
import { utc } from '@/lib/time';
import { Chrome } from '../chrome';
import { SignupSwitch } from './signup-switch';

/**
 * The tenants, and what is actually true about them.
 *
 * `plan` decides each company's monthly AI allowance, and can be set here —
 * but nothing is charged for it yet: payments do not exist, and plans are
 * free until they do. The lede says so rather than letting a dashboard imply
 * revenue nobody collected. Everything else here is counted.
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
  return days === 0 ? 'today' : days === 1 ? 'yesterday' : `${days}d ago`;
}

/** Where a company's plan stands, in a few words. */
function standing(sub: Subscription | undefined): string {
  if (!sub) return '';
  const end = sub.period_end && sub.period_end !== 'infinity' ? utc(sub.period_end).slice(0, 10) : '';
  if (sub.status === 'trialing') return `ends ${end}`;
  if (sub.status === 'canceled') return '';
  if (sub.cancel_at_period_end) return `cancels ${end}`;
  if (sub.scheduled_plan) return `→ ${sub.scheduled_plan} ${end}`;
  return '';
}

interface Subscription {
  company_id: string;
  status: string;
  period_end: string;
  cancel_at_period_end: boolean;
  scheduled_plan: string | null;
}

const SORT_LABEL: Record<CompanySort, string> = {
  name: 'Name',
  plan: 'Plan',
  people: 'People',
  calls: 'Calls',
  last: 'Last call',
  failures: 'Failures 24h',
  spend: 'Spend 30d',
};

export default async function Companies({
  searchParams,
}: {
  searchParams: Promise<{ closed?: string; q?: string; sort?: string; reverse?: string }>;
}) {
  const { closed, q, sort: askedSort, reverse } = await searchParams;
  const sort: CompanySort = COMPANY_SORTS.includes(askedSort as CompanySort) ? (askedSort as CompanySort) : 'name';
  const admin = await requireAdmin();
  const [{ companies: all, error }, { data: settings }, { data: subscriptions }] = await Promise.all([
    listCompanies(admin.db),
    admin.db.from('app_settings').select('signup_open, updated_at').maybeSingle(),
    admin.db.from('subscriptions').select('company_id, status, period_end, cancel_at_period_end, scheduled_plan'),
  ]);
  const subs = new Map<string, Subscription>((subscriptions ?? []).map((s) => [s.company_id, s]));
  // Closed companies are the record of what was erased, not work to do;
  // listed only when asked for.
  const closedCount = all.filter((c) => c.closedAt).length;
  const shown = closed === '1' ? all : all.filter((c) => !c.closedAt);
  const companies = findCompanies(shown, q ?? '', sort, reverse === '1');
  // A column heading re-sorts by it; the same heading again reverses.
  const sortHref = (by: CompanySort) => {
    const params = new URLSearchParams();
    if (closed === '1') params.set('closed', '1');
    if (q) params.set('q', q);
    if (by !== 'name') params.set('sort', by);
    if (by === sort && reverse !== '1') params.set('reverse', '1');
    const query = params.toString();
    return query ? `/companies?${query}` : '/companies';
  };
  const heading = (by: CompanySort, className?: string) => (
    <th className={className}>
      <Link className="link" href={sortHref(by)}>
        {SORT_LABEL[by]}
        {by === sort ? (reverse === '1' ? ' ↑' : ' ↓') : ''}
      </Link>
    </th>
  );

  return (
    <Chrome email={admin.email}>
      <h1>Companies</h1>
      <p className="lede">
        One row per tenant; open one to change its plan or close it. Spend is estimated from
        recorded token usage at published rates, not billed — payments do not exist yet.
      </p>

      <SignupSwitch
        open={settings?.signup_open === true}
        changed={settings && settings.updated_at ? utc(settings.updated_at) : null}
      />

      {error ? <p className="tag open">{error}</p> : null}

      <form method="get" className="row" style={{ alignItems: 'end', marginBottom: '0.5rem' }}>
        {closed === '1' ? <input type="hidden" name="closed" value="1" /> : null}
        {sort !== 'name' ? <input type="hidden" name="sort" value={sort} /> : null}
        <label>
          Find a company
          <input name="q" type="search" defaultValue={q ?? ''} placeholder="Name" />
        </label>
        <button type="submit">Search</button>
        {q ? (
          <Link className="link" href={closed === '1' ? '/companies?closed=1' : '/companies'}>
            Clear
          </Link>
        ) : null}
      </form>

      <p className="muted">
        {q ? `${companies.length} match “${q}”. ` : ''}
        {closed === '1' ? (
          <a className="link" href="/companies">
            Hide the {closedCount} closed
          </a>
        ) : (
          <a className="link" href="/companies?closed=1">
            Show the {closedCount} closed
          </a>
        )}
      </p>

      <table>
        <thead>
          <tr>
            {heading('name')}
            {heading('plan')}
            {heading('people', 'num')}
            {heading('calls', 'num')}
            <th className="num">Segments</th>
            {heading('last')}
            {heading('failures', 'num')}
            {heading('spend', 'num')}
            <th className="num">Retention</th>
          </tr>
        </thead>
        <tbody>
          {companies.map((company) => (
            <tr key={company.companyId} className={company.closedAt ? 'muted' : undefined}>
              <td>
                <Link className="link" href={`/companies/${company.companyId}`}>
                  {company.name}
                </Link>
              </td>
              <td>
                {company.closedAt ? (
                  <span className="tag" title={utc(company.closedAt)}>
                    closed
                  </span>
                ) : (
                  <>
                    <span className="tag">{company.plan}</span>{' '}
                    <span className="muted">{standing(subs.get(company.companyId))}</span>
                  </>
                )}
              </td>
              <td className="num">{company.members}</td>
              <td className="num">{company.conversations}</td>
              <td className="num">{company.segments}</td>
              <td className="muted">{ago(company.lastActivity)}</td>
              <td className="num">
                {company.failures24h > 0 ? (
                  <span className="tag open">{company.failures24h}</span>
                ) : (
                  <span className="muted">0</span>
                )}
              </td>
              <td className="num">${company.spend30dUsd.toFixed(2)}</td>
              <td className="num muted">
                {company.retentionDays ? `${company.retentionDays}d` : 'unset'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {companies.length === 0 && !error ? (
        <p className="muted">{q ? 'No company matches that.' : 'No companies yet.'}</p>
      ) : null}
    </Chrome>
  );
}
