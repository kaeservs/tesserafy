import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from './client';
import type { Database } from './generated';

export type { SupabaseClient } from './client';
export { vectorArg } from './vector';
export type { Database };
export type { Json, Tables, TablesInsert, TablesUpdate } from './generated';

export interface SupabaseConnection {
  url: string;
  key: string;
}

/**
 * A client holding the service-role key. It bypasses Row Level Security.
 *
 * Only server code may call this, and any similarity or evidence query made
 * with it must go through retrieve() in @tesserafy/ai — see ADR 0004.
 */
export function createServiceClient({ url, key }: SupabaseConnection): SupabaseClient {
  if (typeof (globalThis as { window?: unknown }).window !== 'undefined') {
    throw new Error('createServiceClient() must never run in a browser.');
  }
  return createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * A client using the publishable (anon) key. Everything it can see is
 * decided by RLS and whichever user signs in on it.
 */
export function createUserClient({ url, key }: SupabaseConnection): SupabaseClient {
  return createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * A client that is a particular signed-in person.
 *
 * Operator tooling needs this where a service-role client would be wrong:
 * with the service key `auth.uid()` is null, so every function that asks who
 * is calling gets no answer and every membership check fails open or closed
 * for the wrong reason. A tool that authorises itself writes an audit trail
 * that records whatever it felt like recording.
 */
export function createTokenClient({
  url,
  key,
  token,
}: SupabaseConnection & { token: string }): SupabaseClient {
  return createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

export {
  fetchCriteria,
  fetchCriteriaSets,
  fetchCriterionLabels,
  type CriteriaSetSummary,
  type CriterionLabel,
  type CriterionRow,
} from './queries/criteria';
export { fetchCriterionEvents, type CriterionEventRow } from './queries/criterion-events';
export { batches, ID_BATCH, PAGE_SIZE, readAll } from './queries/paged';
export {
  ACTIONABLE_KINDS,
  ALARM_AT,
  alarming,
  groupFailures,
  type FailureGroup,
  type FailureRow,
} from './health';
export {
  adoptionCohort,
  adoptionFunnel,
  adoptionStage,
  COMPANY_SORTS,
  findCompanies,
  spendByDetector,
  spendByFeature,
  featureOf,
  spendByWeek,
  type AdoptionRow,
  type CompanySort,
  type FunnelStep,
  type SpendRow,
  type SpendWeek,
} from './console';
export {
  byAttention,
  cohorts,
  FAILING_AT,
  healthFlags,
  NEAR_LIMIT,
  NOT_STARTED_AFTER_DAYS,
  QUIET_AFTER_DAYS,
  weeklyActive,
  type ActiveWeek,
  type Cohort,
  type HealthFlag,
  type HealthRow,
} from './console-health';
