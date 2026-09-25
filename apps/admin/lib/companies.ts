import type { Database, SupabaseClient } from '@tesserafy/db';

/**
 * One row of `admin_companies()`, with `closedAt` typed as it really is.
 *
 * The generated types describe every column a function returns as non-null —
 * they cannot express a nullable column of a returned table — and `closed_at`
 * is null for every company still open, as are retention and last activity
 * for many. Read through here so the one cast that says so is in one place.
 */
export interface CompanyRow {
  companyId: string;
  name: string;
  plan: string;
  retentionDays: number | null;
  members: number;
  conversations: number;
  segments: number;
  lastActivity: string | null;
  failures24h: number;
  spend30dUsd: number;
  closedAt: string | null;
}

/** The generated row, with the columns that can be null saying so. */
type ReturnedRow = Omit<
  Database['public']['Functions']['admin_companies']['Returns'][number],
  'retention_days' | 'last_activity' | 'closed_at'
> & {
  retention_days: number | null;
  last_activity: string | null;
  closed_at: string | null;
};

export async function listCompanies(
  db: SupabaseClient,
): Promise<{ companies: CompanyRow[]; error: string | null }> {
  const { data, error } = await db.rpc('admin_companies');
  const rows = (data ?? []) as ReturnedRow[];
  const companies = rows.map((row) => ({
    companyId: row.company_id,
    name: row.name,
    plan: row.plan,
    retentionDays: row.retention_days,
    members: Number(row.members),
    conversations: Number(row.conversations),
    segments: Number(row.segments),
    lastActivity: row.last_activity,
    failures24h: Number(row.failures_24h),
    spend30dUsd: Number(row.spend_30d_usd),
    closedAt: row.closed_at,
  }));
  return { companies, error: error?.message ?? null };
}
