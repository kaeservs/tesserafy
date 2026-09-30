import type { CallPurpose, Guidance } from '@tesserafy/ai';
import { MAX_EXAMPLES, MAX_INSTRUCTIONS } from '@tesserafy/ai';
import type { SupabaseClient } from '@tesserafy/db';

/**
 * Loading what a company has taught the AI (ai_guidance) for one feature and
 * call type, and what kind of call a scorecard is for. Read as the signed-in
 * person, so RLS keeps it to their company; the company id is named anyway,
 * because operators are members too (the lesson of 20261002090000).
 */

export type Feature = 'scoring' | 'insights' | 'action_items' | 'prep';

export const FEATURE_LABEL: Record<Feature, string> = {
  scoring: 'Scoring',
  insights: 'Finding insights in a call',
  action_items: 'Action items',
  prep: 'Call prep',
};

export const PURPOSES: readonly CallPurpose[] = ['sales', 'customer_success', 'support', 'recruiting', 'internal', 'other'];

/** Tesserafy's templates, until a company says otherwise. */
const TEMPLATE_PURPOSE: Record<string, CallPurpose> = {
  discovery: 'sales',
  demo: 'sales',
  renewal: 'customer_success',
};

export function defaultPurpose(engagementType: string): CallPurpose {
  return TEMPLATE_PURPOSE[engagementType] ?? 'other';
}

export async function purposeOf(db: SupabaseClient, companyId: string, engagementType: string): Promise<CallPurpose> {
  const { data } = await db
    .from('scorecard_purposes')
    .select('purpose')
    .eq('company_id', companyId)
    .eq('engagement_type', engagementType)
    .maybeSingle();
  return (data?.purpose as CallPurpose | undefined) ?? defaultPurpose(engagementType);
}

/**
 * The active guidance for a feature: instructions for every call type or this
 * one, and — for scoring — examples learned from corrections, oldest first so
 * the newest sit nearest the rules. With engagementType null (a live call,
 * whose scorecard the detector is not told), every call type's scoring
 * guidance, which the renderer narrows to the criteria actually in play.
 */
export async function loadGuidance(
  db: SupabaseClient,
  companyId: string,
  feature: Feature,
  engagementType: string | null,
  purpose: CallPurpose | null = null,
): Promise<Guidance> {
  let query = db
    .from('ai_guidance')
    .select('kind, criterion_key, body, quote, counts, engagement_type, created_at')
    .eq('company_id', companyId)
    .eq('feature', feature)
    .eq('active', true)
    .order('created_at', { ascending: true })
    .limit(500);
  if (engagementType) query = query.or(`engagement_type.is.null,engagement_type.eq.${engagementType}`);
  const { data } = await query;
  const rows = data ?? [];
  return {
    purpose,
    instructions: rows
      .filter((row) => row.kind === 'instruction')
      .slice(-MAX_INSTRUCTIONS)
      .map((row) => ({ criterionKey: row.criterion_key, text: row.body })),
    examples: rows
      .filter((row) => row.kind === 'example' && row.quote !== null && row.counts !== null && row.criterion_key !== null)
      .slice(-MAX_EXAMPLES)
      .map((row) => ({ criterionKey: row.criterion_key!, quote: row.quote!, counts: row.counts!, reason: row.body })),
  };
}
