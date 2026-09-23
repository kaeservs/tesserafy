import type { SupabaseClient as UntypedClient } from '@supabase/supabase-js';
import type { Database } from './generated';

/**
 * Every client in this codebase knows the schema.
 *
 * Until the generated types existed, `SupabaseClient` meant the untyped one:
 * every query came back as `unknown` and every call site asserted its own
 * shape by hand. Those casts were claims about columns that nothing checked,
 * and they stayed convincing long after the column changed.
 *
 * It keeps the name `SupabaseClient` rather than introducing a second one on
 * purpose. A codebase holding both a typed and an untyped client under
 * different names drifts back to the untyped one by accident, one import at a
 * time.
 *
 * It lives in its own file so the query modules can have it without importing
 * the package index that re-exports them.
 */
export type SupabaseClient = UntypedClient<Database>;
