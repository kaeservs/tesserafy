import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Reading the criteria a scorecard is built from.
 *
 * Returns rows rather than a built CriteriaSet: this package has no opinion
 * about scoring, and `defineCriteriaSet` in @tesserafy/scoring is what turns
 * rows into something the engine will accept — including rejecting a row whose
 * thresholds are nonsense. Keeping that validation in one place means a bad
 * row fails the same way whether it arrived from here or from a fixture.
 */
export interface CriterionRow {
  readonly engagement_type: string;
  readonly version: number;
  readonly key: string;
  readonly label: string;
  readonly definition: string;
  readonly weight: number;
  readonly candidate_threshold: number;
  readonly confirm_threshold: number;
  readonly corroborating_segments: number;
  readonly position: number;
}

/**
 * The criteria for one engagement type, in display order.
 *
 * `version` defaults to the highest available. A conversation being scored
 * live wants the current set; a conversation being re-scored later must pass
 * the version it was scored against, which is why that is an argument rather
 * than always the latest.
 */
export async function fetchCriteria(
  db: SupabaseClient,
  engagementType: string,
  version?: number,
): Promise<CriterionRow[]> {
  let query = db
    .from('criteria_definitions')
    .select(
      'engagement_type, version, key, label, definition, weight, candidate_threshold, confirm_threshold, corroborating_segments, position',
    )
    .eq('engagement_type', engagementType);

  if (version !== undefined) {
    query = query.eq('version', version);
  }

  const { data, error } = await query.order('version', { ascending: false }).order('position');
  if (error) {
    throw new Error(`Loading criteria failed: ${error.message}`, { cause: error });
  }

  const rows = (data ?? []) as CriterionRow[];
  if (rows.length === 0) {
    throw new Error(
      `No criteria for engagement type "${engagementType}"${version ? ` version ${version}` : ''}`,
    );
  }

  // The order above puts the newest version first; keep only that one when no
  // version was asked for, so a new set never half-merges with its predecessor.
  const chosen = version ?? rows[0]!.version;
  return rows.filter((row) => row.version === chosen).sort((a, b) => a.position - b.position);
}

/** One engagement type at one version, with how many criteria it holds. */
export interface CriteriaSetSummary {
  readonly engagementType: string;
  readonly version: number;
  readonly criteria: number;
}

/**
 * Every criteria set, newest version of each type first.
 *
 * For choosing one — a live call has to be told what it is being scored
 * against, and until there was more than one set that choice could be a
 * hardcoded string. Returns summaries rather than definitions: a picker needs
 * names and nothing else, and sending every prompt to render a dropdown would
 * be sending the detector's instructions to a browser that has no use for
 * them.
 */
export async function fetchCriteriaSets(db: SupabaseClient): Promise<CriteriaSetSummary[]> {
  const { data, error } = await db
    .from('criteria_definitions')
    .select('engagement_type, version')
    .order('engagement_type')
    .order('version', { ascending: false });

  if (error) {
    throw new Error(`Listing criteria sets failed: ${error.message}`, { cause: error });
  }

  const counts = new Map<string, CriteriaSetSummary>();
  for (const row of (data ?? []) as { engagement_type: string; version: number }[]) {
    const key = `${row.engagement_type}/${row.version}`;
    const seen = counts.get(key);
    counts.set(
      key,
      seen
        ? { ...seen, criteria: seen.criteria + 1 }
        : { engagementType: row.engagement_type, version: row.version, criteria: 1 },
    );
  }

  return [...counts.values()];
}
