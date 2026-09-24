/**
 * Fixture IDs from supabase/seed/0001_two_tenants.sql, and the connection
 * details integration tests need. Test code only.
 */

export const SEED = {
  companyA: {
    id: '00000000-0000-4000-8000-00000000000a',
    conversationId: '00000000-0000-4000-8000-0000000000a1',
    sharedQuoteSegmentId: '00000000-0000-4000-8000-000000000a11',
    unrelatedSegmentId: '00000000-0000-4000-8000-000000000a12',
  },
  companyB: {
    id: '00000000-0000-4000-8000-00000000000b',
    conversationId: '00000000-0000-4000-8000-0000000000b1',
    sharedQuoteSegmentId: '00000000-0000-4000-8000-000000000b11',
    unrelatedSegmentId: '00000000-0000-4000-8000-000000000b12',
  },
} as const;

export const EMBEDDING_DIMENSIONS = 384;

/** The vector the seed gives both copies of the shared quote. */
export function sharedQuoteEmbedding(): number[] {
  return new Array<number>(EMBEDDING_DIMENSIONS).fill(1);
}

export interface IntegrationEnv {
  url: string;
  anonKey: string;
  serviceRoleKey: string;
}

/**
 * Reads the local Supabase stack's connection details.
 *
 * Throws rather than letting tests skip: the cross-tenant tests are
 * release-blocking, and a blocking test that quietly skips blocks nothing.
 */
export function requireIntegrationEnv(): IntegrationEnv {
  const url = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  const missing = [
    ['SUPABASE_URL', url],
    ['SUPABASE_ANON_KEY', anonKey],
    ['SUPABASE_SERVICE_ROLE_KEY', serviceRoleKey],
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name);

  if (missing.length > 0 || !url || !anonKey || !serviceRoleKey) {
    throw new Error(
      `Integration tests need a local Supabase stack. Missing: ${missing.join(', ')}. ` +
        'Run `pnpm exec supabase start`, then export the values from `pnpm exec supabase status`.',
    );
  }

  if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?/.test(url)) {
    throw new Error(
      `Refusing to run integration tests against ${url}. They create users and ` +
        'must only ever target a local stack.',
    );
  }

  return { url, anonKey, serviceRoleKey };
}
