import Link from 'next/link';
import { ALARM_AT, alarming, groupFailures, type FailureRow } from '@tesserafy/db';
import { requireAdmin } from '@/lib/admin';
import { listCompanies } from '@/lib/companies';
import { ago, utc } from '@/lib/time';
import { Chrome } from '../chrome';

/**
 * What failed in production, and whether any of it needs a person.
 *
 * The same rows and the same judgement as `pnpm health` — the scheduled job
 * that emails when something needs a person — through the same shared rules,
 * so this page and that alarm cannot disagree. Until now the console showed a
 * count and nothing behind it, and seeing what failed meant a terminal holding
 * the service-role key.
 *
 * Messages were scrubbed of credentials and customer identifiers before they
 * were recorded (packages/ai/src/telemetry/failures.ts); what is shown is what
 * was kept. Operators read every row through RLS as themselves.
 */
export const dynamic = 'force-dynamic';

const WINDOWS = [
  { hours: 24, label: '24 hours' },
  { hours: 168, label: '7 days' },
  { hours: 720, label: '30 days' },
] as const;

const KIND: Record<string, string> = {
  model_rejected: 'a request we built wrong',
  billing: 'out of credit with the model provider',
  database: 'our database refused',
  model_unavailable: 'model overloaded or down',
  input: 'unusable input from a caller',
  unknown: 'unclassified',
};

export default async function Failures({ searchParams }: { searchParams: Promise<{ hours?: string }> }) {
  const { hours: asked } = await searchParams;
  const hours = WINDOWS.find((w) => String(w.hours) === asked)?.hours ?? 24;
  const admin = await requireAdmin();

  const since = new Date(Date.now() - hours * 3_600_000).toISOString();
  const [{ data, error }, { companies }] = await Promise.all([
    admin.db
      .from('system_failures')
      .select('source, kind, tier, model, status, message, created_at, company_id')
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(1000),
    listCompanies(admin.db),
  ]);
  const rows: FailureRow[] = data ?? [];
  const groups = groupFailures(rows);
  const needsYou = alarming(groups);
  const nameOf = new Map(companies.map((c) => [c.companyId, c.name]));

  return (
    <Chrome email={admin.email}>
      <h1>Failures</h1>
      <p className="lede">
        Everything that failed on its way to a customer, grouped by what broke and where. The same
        judgement as the scheduled health check, which emails when something here needs a person.
      </p>

      <p>
        {WINDOWS.map((w, i) => (
          <span key={w.hours}>
            {i > 0 ? ' · ' : ''}
            {w.hours === hours ? (
              <strong>{w.label}</strong>
            ) : (
              <Link className="link" href={`/failures?hours=${w.hours}`}>
                {w.label}
              </Link>
            )}
          </span>
        ))}
      </p>

      {error ? <p className="tag open">{error.message}</p> : null}

      <section className="card">
        {rows.length === 0 ? (
          <p style={{ margin: 0 }}>Nothing failed in the last {WINDOWS.find((w) => w.hours === hours)?.label}.</p>
        ) : needsYou === 0 ? (
          <p style={{ margin: 0 }}>
            {rows.length} failure{rows.length === 1 ? '' : 's'}, and <strong>none needs a person</strong>:
            no bug of ours repeated {ALARM_AT} or more times. Overloaded models and bad input
            correct themselves or are the caller&apos;s to fix.
          </p>
        ) : (
          <p style={{ margin: 0 }}>
            <span className="tag open">{needsYou} need a person</span> Requests we built wrong or our
            own database refusing us, repeated — those do not fix themselves.
          </p>
        )}
      </section>

      {groups.length > 0 ? (
        <table tabIndex={0}>
          <thead>
            <tr>
              <th />
              <th>What</th>
              <th>Where</th>
              <th>Times</th>
              <th>Last</th>
              <th>Companies</th>
              <th>Latest message</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <tr key={`${g.kind}-${g.source}-${g.status ?? ''}`}>
                <td>{g.needsAPerson ? <span className="tag open">!</span> : <span className="muted">–</span>}</td>
                <td>
                  {KIND[g.kind] ?? g.kind}
                  <div className="muted">{g.kind}</div>
                </td>
                <td>
                  {g.source}
                  <div className="muted">{[g.tier, g.model, g.status].filter(Boolean).join(' · ')}</div>
                </td>
                <td className="num">{g.count}</td>
                <td className="muted" title={utc(g.last)}>
                  {ago(g.last)}
                  {g.count > 1 ? <div>since {utc(g.first)}</div> : null}
                </td>
                <td>
                  {g.companyIds.length === 0 ? (
                    <span className="muted">none known</span>
                  ) : (
                    g.companyIds.map((id, i) => (
                      <span key={id}>
                        {i > 0 ? ', ' : ''}
                        <Link className="link" href={`/companies/${id}`}>
                          {nameOf.get(id) ?? 'a closed company'}
                        </Link>
                      </span>
                    ))
                  )}
                </td>
                <td className="muted">{g.message}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </Chrome>
  );
}
