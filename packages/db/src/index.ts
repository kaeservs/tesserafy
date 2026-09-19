import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export type { SupabaseClient };

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
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * A client using the publishable (anon) key. Everything it can see is
 * decided by RLS and whichever user signs in on it.
 */
export function createUserClient({ url, key }: SupabaseConnection): SupabaseClient {
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export { fetchCriteria, type CriterionRow } from './queries/criteria';
