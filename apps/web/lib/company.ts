import type { SupabaseClient } from '@tesserafy/db';

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
