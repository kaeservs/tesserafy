import Link from 'next/link';
import { requireAdmin } from '@/lib/admin';
import { utc } from '@/lib/time';
import { Chrome } from '../chrome';

/**
 * Recording agreements (ADR 0020): every person's one-time agreement to tell
 * everyone on every call they record, with the words, the Terms version and
 * where they agreed. The record that places that responsibility on them, so
 * it outlives their account. Read as the operator, through RLS.
 */
export const dynamic = 'force-dynamic';

export default async function Agreements() {
  const admin = await requireAdmin();
  const [{ data: rows, error }, { data: companies }] = await Promise.all([
    admin.db
      .from('recording_agreements')
      .select('id, email, company_id, terms_version, surface, statement, agreed_at')
      .order('agreed_at', { ascending: false })
      .limit(500),
    // Operators read companies through admin_companies, not the table.
    admin.db.rpc('admin_companies'),
  ]);
  const nameOf = new Map((companies ?? []).map((company) => [company.company_id, company.name]));
  const versions = [...new Set((rows ?? []).map((row) => row.terms_version))];

  return (
    <Chrome email={admin.email}>
      <h1>Recording agreements</h1>
      <p className="lede">
        Each person agrees once — in the overlay or on the web — to tell everyone on every call they record, and that
        doing so is their responsibility. Every live call they record cites it. Kept after an account is deleted.
      </p>
      {error ? <p className="tag open">{error.message}</p> : null}
      <section className="card">
        <p className="muted" style={{ marginTop: 0 }}>
          {(rows ?? []).length} agreement{(rows ?? []).length === 1 ? '' : 's'}
          {versions.length > 0 ? ` · Terms ${versions.join(', ')}` : ''}
        </p>
        {(rows ?? []).length === 0 ? (
          <p className="muted" style={{ marginBottom: 0 }}>Nobody has agreed yet.</p>
        ) : (
          <table tabIndex={0}>
            <thead>
              <tr>
                <th>Person</th>
                <th>Company</th>
                <th>Agreed</th>
                <th>Terms</th>
                <th>Where</th>
              </tr>
            </thead>
            <tbody>
              {(rows ?? []).map((row) => (
                <tr key={row.id}>
                  <td>
                    <details>
                      <summary>{row.email}</summary>
                      <p className="muted" style={{ maxWidth: '40rem' }}>
                        {row.statement}
                      </p>
                    </details>
                  </td>
                  <td>
                    <Link className="link" href={`/companies/${row.company_id}`}>
                      {nameOf.get(row.company_id) ?? 'a company no longer listed'}
                    </Link>
                  </td>
                  <td className="muted">{utc(row.agreed_at)}</td>
                  <td className="muted">{row.terms_version}</td>
                  <td className="muted">{row.surface}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </Chrome>
  );
}
