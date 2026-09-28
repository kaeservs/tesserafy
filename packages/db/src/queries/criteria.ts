import type { SupabaseClient } from '../client';

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
  /** Null for a Tesserafy template; the owning company for a company's own set (ADR 0016). */
  readonly company_id: string | null;
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

const COLUMNS =
  'company_id, engagement_type, version, key, label, definition, weight, candidate_threshold, confirm_threshold, corroborating_segments, position';

/**
 * Which sets a read may see: the templates, plus one company's own.
 *
 * Required rather than left to RLS, for the same reason `retrieve()` takes a
 * company first. RLS already hides other companies' sets from a member, but an
 * operator reads every company's, and so does a service-role script — and two
 * companies may each have a "demo". A read that did not say whose "demo" would
 * be answered by whichever came back first. `null` asks for templates alone.
 */
function scoped<Q extends { is: (column: 'company_id', value: null) => Q; or: (filter: string) => Q }>(
  query: Q,
  companyId: string | null,
): Q {
  return companyId === null
    ? query.is('company_id', null)
    : query.or(`company_id.is.null,company_id.eq.${companyId}`);
}

/**
 * The criteria for one engagement type, in display order.
 *
 * `version` defaults to the highest available. A conversation being scored
 * live wants the current set; a conversation being re-scored later must pass
 * the version it was scored against, which is why that is an argument rather
 * than always the latest. `companyId` is the conversation's company, or null
 * for templates only.
 */
export async function fetchCriteria(
  db: SupabaseClient,
  companyId: string | null,
  engagementType: string,
  version?: number,
): Promise<CriterionRow[]> {
  let query = scoped(
    db.from('criteria_definitions').select(COLUMNS).eq('engagement_type', engagementType),
    companyId,
  );

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
  // The database refuses a company set named like a template, so this cannot
  // happen; if it ever does, a scorecard built from two sets is worse than none.
  if (new Set(rows.map((row) => row.company_id ?? null)).size > 1) {
    throw new Error(`Criteria "${engagementType}" matched more than one owner`);
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
  /** The company's own set, rather than a Tesserafy template. */
  readonly own: boolean;
  readonly publishedAt: string;
}

/**
 * Every criteria set a company may use, newest version of each type first.
 *
 * For choosing one — a live call has to be told what it is being scored
 * against, and until there was more than one set that choice could be a
 * hardcoded string. Returns summaries rather than definitions: a picker needs
 * names and nothing else, and sending every prompt to render a dropdown would
 * be sending the detector's instructions to a browser that has no use for
 * them.
 */
export async function fetchCriteriaSets(
  db: SupabaseClient,
  companyId: string | null,
): Promise<CriteriaSetSummary[]> {
  const { data, error } = await scoped(
    db.from('criteria_definitions').select('company_id, engagement_type, version, created_at'),
    companyId,
  )
    .order('engagement_type')
    .order('version', { ascending: false });

  if (error) {
    throw new Error(`Listing criteria sets failed: ${error.message}`, { cause: error });
  }

  const counts = new Map<string, CriteriaSetSummary>();
  for (const row of (data ?? []) as {
    company_id: string | null;
    engagement_type: string;
    version: number;
    created_at: string;
  }[]) {
    const key = `${row.engagement_type}/${row.version}`;
    const seen = counts.get(key);
    counts.set(
      key,
      seen
        ? { ...seen, criteria: seen.criteria + 1 }
        : {
            engagementType: row.engagement_type,
            version: row.version,
            criteria: 1,
            own: row.company_id !== null,
            publishedAt: row.created_at,
          },
    );
  }

  return [...counts.values()];
}
