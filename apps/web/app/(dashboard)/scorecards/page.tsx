import Link from 'next/link';
import { fetchCriteriaSets, type CriteriaSetSummary } from '@tesserafy/db';
import { engagementLabel, myCompanyId } from '@/lib/company';
import { createClient } from '@/lib/supabase/server';

export const metadata = { title: 'Scorecards · Tesserafy' };

/**
 * What calls are scored against (ADR 0016).
 *
 * Two kinds, said plainly: the company's own scorecards, which its owner
 * writes, and Tesserafy's templates, which every company may use or start
 * from. Everyone in the company can read both — a seller is entitled to know
 * what they are measured on. Only an owner is offered the editor.
 */
function day(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { dateStyle: 'medium', timeZone: 'UTC' });
}

/** The newest version of each set, with how many versions it has had. */
function newest(sets: readonly CriteriaSetSummary[]): (CriteriaSetSummary & { versions: number })[] {
  const byName = new Map<string, CriteriaSetSummary & { versions: number }>();
  for (const set of sets) {
    const seen = byName.get(set.engagementType);
    if (!seen) byName.set(set.engagementType, { ...set, versions: 1 });
    else byName.set(set.engagementType, { ...(set.version > seen.version ? set : seen), versions: seen.versions + 1 });
  }
  return [...byName.values()];
}

function SetTable({ sets, caption }: { sets: (CriteriaSetSummary & { versions: number })[]; caption: string }) {
  return (
    <table className="team">
      <caption className="visually-hidden">{caption}</caption>
      <thead>
        <tr>
          <th scope="col">Scorecard</th>
          <th scope="col">Version</th>
          <th scope="col">Criteria</th>
          <th scope="col">Published</th>
        </tr>
      </thead>
      <tbody>
        {sets.map((set) => (
          <tr key={set.engagementType}>
            <td>
              <Link href={`/scorecards/${set.engagementType}`}>{engagementLabel(set.engagementType)}</Link>
            </td>
            <td>
              {set.version}
              {set.versions > 1 ? <span className="muted"> of {set.versions}</span> : null}
            </td>
            <td>{set.criteria}</td>
            <td>{day(set.publishedAt)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default async function ScorecardsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const companyId = await myCompanyId(supabase, user?.id);
  const [sets, { data: membership }] = await Promise.all([
    fetchCriteriaSets(supabase, companyId),
    supabase.from('company_members').select('role').eq('user_id', user?.id ?? '').limit(1).maybeSingle(),
  ]);
  const isOwner = membership?.role === 'owner';

  const own = newest(sets.filter((set) => set.own));
  const templates = newest(sets.filter((set) => !set.own));

  return (
    <main>
      <h1>Scorecards</h1>
      <p className="muted">
        What each call is scored against. A call keeps the scorecard version it was scored with, so
        publishing a new version never changes a score you have already seen.
      </p>
      {isOwner ? (
        <p>
          <Link href="/scorecards/new">New scorecard</Link>
        </p>
      ) : null}

      <section aria-labelledby="own-heading">
        <h2 id="own-heading">Your scorecards</h2>
        {own.length > 0 ? (
          <SetTable sets={own} caption="Your company's scorecards" />
        ) : (
          <p className="muted">
            None yet.{' '}
            {isOwner
              ? 'Write one for the calls your team actually runs — a demo, a renewal, your own discovery — or start from a template below.'
              : 'An owner of your company can write one.'}
          </p>
        )}
      </section>

      <section aria-labelledby="templates-heading">
        <h2 id="templates-heading">Tesserafy templates</h2>
        <p className="muted">Available to every company. {isOwner ? 'Open one to make your own from it.' : null}</p>
        <SetTable sets={templates} caption="Tesserafy templates" />
      </section>
    </main>
  );
}
