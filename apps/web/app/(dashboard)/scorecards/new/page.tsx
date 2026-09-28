import Link from 'next/link';
import { fetchCriteria, fetchCriteriaSets } from '@tesserafy/db';
import { ScorecardEditor, type EditorStart } from '@/components/scorecard-editor';
import { engagementLabel, myCompanyId } from '@/lib/company';
import { createClient } from '@/lib/supabase/server';

export const metadata = { title: 'New scorecard · Tesserafy' };

/**
 * Writing a scorecard: from nothing, from a template, or as the next version
 * of one of the company's own.
 *
 * Starting from the company's own set fixes the name, because the result is
 * that set's next version. Starting from a template makes a new set, since a
 * company's scorecard may not share a template's name (ADR 0016).
 */
export default async function NewScorecardPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; version?: string }>;
}) {
  const { from, version } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: membership } = await supabase
    .from('company_members')
    .select('role')
    .eq('user_id', user?.id ?? '')
    .limit(1)
    .maybeSingle();

  if (membership?.role !== 'owner') {
    return (
      <main>
        <p>
          <Link href="/scorecards">← Scorecards</Link>
        </p>
        <h1>New scorecard</h1>
        <p role="alert">Only an owner of your company can write a scorecard.</p>
      </main>
    );
  }

  const companyId = await myCompanyId(supabase, user?.id);
  const sets = await fetchCriteriaSets(supabase, companyId);
  const templates = [...new Set(sets.filter((set) => !set.own).map((set) => set.engagementType))];
  const source = from ? sets.find((set) => set.engagementType === from) : undefined;

  let start: EditorStart = { name: null, title: '', nextVersion: 1, criteria: [] };
  if (source) {
    const rows = await fetchCriteria(supabase, companyId, source.engagementType, version ? Number(version) : undefined);
    const newest = Math.max(...sets.filter((set) => set.engagementType === source.engagementType).map((set) => set.version));
    const criteria = rows.map((row) => ({
      key: row.key,
      label: row.label,
      definition: row.definition,
      weight: row.weight,
    }));
    start = source.own
      ? { name: source.engagementType, title: engagementLabel(source.engagementType), nextVersion: newest + 1, criteria }
      : { name: null, title: `Our ${engagementLabel(source.engagementType).toLowerCase()}`, nextVersion: 1, criteria };
  }

  return (
    <main>
      <p>
        <Link href={source ? `/scorecards/${encodeURIComponent(source.engagementType)}` : '/scorecards'}>
          ← {source ? engagementLabel(source.engagementType) : 'Scorecards'}
        </Link>
      </p>
      <h1>{start.name ? `${engagementLabel(start.name)}, version ${start.nextVersion}` : 'New scorecard'}</h1>
      <p className="muted">
        Each criterion is something that should happen on a good call, described the way it would sound.
        The description is what the detector listens for, so write what a customer or seller would say,
        not what you would put on a slide. Try it on your recent calls before you publish.
      </p>
      <ScorecardEditor start={start} templates={templates} />
    </main>
  );
}
