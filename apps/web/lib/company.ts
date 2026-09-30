import { fetchCriteriaSets, type SupabaseClient } from '@tesserafy/db';

/**
 * The signed-in person's company, as far as pages need it.
 *
 * RLS returns only companies the caller belongs to, and a person belongs to
 * one, so the first row is theirs.
 */
export async function myCompany(db: SupabaseClient): Promise<{ name: string; plan: string } | null> {
  const { data } = await db.from('companies').select('name, plan').limit(1).maybeSingle();
  return data ?? null;
}

/**
 * The signed-in person's company id, from their own membership.
 *
 * Not from `companies`: an operator reads every company there, and the first
 * row would be somebody else's. Null for nobody, and for a person in more than
 * one company — which no one is yet, and which is refused rather than guessed.
 */
export async function myCompanyId(db: SupabaseClient, userId?: string): Promise<string | null> {
  const uid = userId ?? (await db.auth.getUser()).data.user?.id;
  if (!uid) return null;
  const { data } = await db.from('company_members').select('company_id').eq('user_id', uid);
  return data?.length === 1 ? data[0]!.company_id : null;
}

/**
 * Whether the live scorecard is offered.
 *
 * Only to Tesserafy's own company for now. Live transcription still uses the
 * browser's speech recognition, which sends audio to the browser vendor — the
 * page says itself that this is not acceptable for a customer call — and the
 * page is a test bench, latency panel and all. Brands see "coming soon" until
 * a transcriber that runs under our own terms is chosen (spike S2).
 */
export function liveAvailable(plan: string | undefined): boolean {
  return plan === 'internal';
}

/** "discovery" → "Discovery", "quarterly_review" → "Quarterly review". */
export function engagementLabel(type: string): string {
  const words = type.replace(/[_-]+/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * Whether the signed-in person's company can still import the sample call:
 * it has not had it yet. Deleting the sample does not bring the offer back
 * (import_sample_call keeps the date it was taken), so this reads the same.
 */
export async function sampleCallOffered(db: SupabaseClient): Promise<boolean> {
  const companyId = await myCompanyId(db);
  if (!companyId) return false;
  const { data } = await db.from('companies').select('sample_imported_at').eq('id', companyId).maybeSingle();
  return data !== null && data.sample_imported_at === null;
}

/**
 * The scorecard a new import uses when nobody picks one: the company's
 * default, at its newest version. Null with no default set.
 */
export async function companyDefaultScorecard(
  db: SupabaseClient,
  userId: string,
): Promise<{ engagementType: string; version: number } | null> {
  const companyId = await myCompanyId(db, userId);
  if (!companyId) return null;
  const { data } = await db.from('companies').select('default_engagement_type').eq('id', companyId).maybeSingle();
  const engagementType = data?.default_engagement_type;
  if (!engagementType) return null;
  const sets = await fetchCriteriaSets(db, companyId);
  const newest = sets.filter((set) => set.engagementType === engagementType).sort((a, b) => b.version - a.version)[0];
  return newest ? { engagementType, version: newest.version } : null;
}

