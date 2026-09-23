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

export {
  fetchCriteria,
  fetchCriteriaSets,
  type CriteriaSetSummary,
  type CriterionRow,
} from './queries/criteria';
export { fetchCriterionEvents, type CriterionEventRow } from './queries/criterion-events';
