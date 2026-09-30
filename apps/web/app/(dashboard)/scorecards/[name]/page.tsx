import { criterionHealth } from '@/lib/criterion-health';
import { TableScroll } from '@/components/table-scroll';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { fetchCriteria, fetchCriteriaSets } from '@tesserafy/db';
import { MoveCalls } from '@/components/move-calls';
import { engagementLabel, myCompanyId } from '@/lib/company';
import { createClient } from '@/lib/supabase/server';

export const metadata = { title: 'Scorecard · Tesserafy' };

function day(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { dateStyle: 'medium', timeZone: 'UTC' });
}

/**
 * One scorecard: what each criterion means, every version it has had, and
 * how many calls each version scored.
 *
 * The descriptions are shown in full. They are what the detector listens for,
 * and a seller measured against "Pain quantified" deserves to read what that
 * means here rather than guess.
 */
export default async function ScorecardPage({
  params,
  searchParams,
}: {
  params: Promise<{ name: string }>;
  searchParams: Promise<{ version?: string; published?: string }>;
}) {
  const { name } = await params;
  const { version: asked, published } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const companyId = await myCompanyId(supabase, user?.id);

  const [sets, { data: membership }] = await Promise.all([
    fetchCriteriaSets(supabase, companyId),
    supabase.from('company_members').select('role').eq('user_id', user?.id ?? '').limit(1).maybeSingle(),
  ]);
  const versions = sets.filter((set) => set.engagementType === name).sort((a, b) => b.version - a.version);
  if (versions.length === 0) notFound();
  const isOwner = membership?.role === 'owner';
  const own = versions[0]!.own;

  const chosen = versions.find((set) => String(set.version) === asked) ?? versions[0]!;
  const criteria = await fetchCriteria(supabase, companyId, name, chosen.version);

  // Calls pinned to each version, in this company. A head count each: a
  // handful of versions at most, and no rows leave the database.
  const counts = await Promise.all(
    versions.map(async (set) => {
      const { count } = await supabase
        .from('conversations')
        .select('id', { count: 'exact', head: true })
        .eq('engagement_type', name)
        .eq('criteria_version', set.version)
        .eq('company_id', companyId ?? '');
      return [set.version, count ?? 0] as const;
    }),
  );
  const callsFor = new Map(counts);
  const onOlder = versions.slice(1).reduce((sum, set) => sum + (callsFor.get(set.version) ?? 0), 0);
  const totalWeight = criteria.reduce((sum, row) => sum + row.weight, 0);

  // Where people have corrected the AI on this scorecard, across its versions.
  const { data: correctionRows } = await supabase
    .from('criterion_events')
    .select('criterion_key, kind, reason, quote, created_at, conversation_id')
    .eq('company_id', companyId ?? '')
    .eq('detector', 'person')
    .order('created_at', { ascending: false })
    .limit(1000);
  const { data: callRows } = await supabase
    .from('conversations')
    .select('id')
    .eq('company_id', companyId ?? '')
    .eq('engagement_type', name)
    .limit(5000);
  const onThisScorecard = new Set((callRows ?? []).map((row) => row.id));
  const health = criterionHealth(
    criteria.map((row) => ({ key: row.key, label: row.label })),
    (correctionRows ?? [])
      .filter((row) => onThisScorecard.has(row.conversation_id))
      .map((row) => ({ criterionKey: row.criterion_key, kind: row.kind, reason: row.reason, quote: row.quote, createdAt: row.created_at })),
    onThisScorecard.size,
  );
  const corrected = health.filter((row) => row.missed + row.wrong > 0);

  return (
    <main>
      <p>
        <Link href="/scorecards">← Scorecards</Link>
      </p>
      <h1>{engagementLabel(name)}</h1>
      <p className="muted">
        {own ? 'Your company’s scorecard' : 'A Tesserafy template'} · version {chosen.version}
        {chosen.version !== versions[0]!.version ? ' (not the newest)' : ''} · published {day(chosen.publishedAt)}
      </p>

      {published ? (
        <p role="status" className="card">
          Version {published} is published. New calls can be scored with it; calls already scored keep
          the version they were scored with.
        </p>
      ) : null}

      {isOwner ? (
        <p>
          <Link href={`/scorecards/new?from=${encodeURIComponent(name)}&version=${chosen.version}`}>
            {own ? `Edit — publishes version ${versions[0]!.version + 1}` : 'Make your own from this template'}
          </Link>
        </p>
      ) : null}

      <section aria-labelledby="criteria-heading">
        <h2 id="criteria-heading">Criteria</h2>
        <p className="muted">
          A call scores the share of this weight it earns. Each criterion counts once it is confirmed: one
          clear moment, or two separate moments that each suggest it.
        </p>
        <ol>
          {criteria.map((row) => (
            <li key={row.key} className="criterion-edit">
              <strong>{row.label}</strong>{' '}
              <span className="muted">
                weight {row.weight} · {Math.round((row.weight / totalWeight) * 100)}% of the score
              </span>
              <br />
              {row.definition}
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="health-heading">
        <h2 id="health-heading">Criterion health</h2>
        {corrected.length === 0 ? (
          <p className="muted">
            Nobody has corrected the AI on this scorecard yet. When someone presses <em>This score is wrong</em> on a call,
            it shows here, criterion by criterion.
          </p>
        ) : (
          <>
            <p className="muted">
              How often people corrected the AI on each criterion, across {onThisScorecard.size} call
              {onThisScorecard.size === 1 ? '' : 's'}. One corrected often reads differently to the AI than to your team:
              reword it in the next version, or teach it with an example.
            </p>
            <TableScroll label="Criterion health">
              <table className="team">
                <thead>
                  <tr>
                    <th scope="col">Criterion</th>
                    <th scope="col">It missed it</th>
                    <th scope="col">It was wrong</th>
                    <th scope="col">Of calls</th>
                    <th scope="col">Latest reason</th>
                  </tr>
                </thead>
                <tbody>
                  {corrected.map((row) => (
                    <tr key={row.key}>
                      <td>
                        {row.label}
                        {row.attention ? <span className="stage stage-proposed"> worth a look</span> : null}
                      </td>
                      <td>{row.missed}</td>
                      <td>{row.wrong}</td>
                      <td className="when">{Math.round(row.rate * 100)}%</td>
                      <td className="muted">
                        {row.latest[0]?.reason ?? '—'}
                        {row.latest[0]?.quote ? <> — “{row.latest[0].quote}”</> : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScroll>
          </>
        )}
      </section>

      <section aria-labelledby="versions-heading">
        <h2 id="versions-heading">Versions</h2>
        <TableScroll label="Criteria">
          <table className="team">
            <thead>
              <tr>
                <th scope="col">Version</th>
                <th scope="col">Criteria</th>
                <th scope="col">Published</th>
                <th scope="col">Calls scored with it</th>
              </tr>
            </thead>
            <tbody>
              {versions.map((set) => (
                <tr key={set.version}>
                  <td>
                    {set.version === chosen.version ? (
                      <strong>{set.version}</strong>
                    ) : (
                      <Link href={`/scorecards/${encodeURIComponent(name)}?version=${set.version}`}>{set.version}</Link>
                    )}
                  </td>
                  <td>{set.criteria}</td>
                  <td className="when">{day(set.publishedAt)}</td>
                  <td>{callsFor.get(set.version) ?? 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
        {/* Kept on the page after the last call moves, so its message stays. */}
        {isOwner && versions.length > 1 ? (
          <MoveCalls name={name} newest={versions[0]!.version} onOlder={onOlder} />
        ) : null}
      </section>
    </main>
  );
}
