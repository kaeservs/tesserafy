import type { SupabaseClient } from '@tesserafy/db';

/**
 * Who is asking, and in which company, for the Settings and Account pages:
 * each is its own page now and reads this first.
 *
 * Every read after it names the company: an operator is a member too, and
 * operators may read these tables across every company (the lesson of
 * 20261002090000).
 */
export async function myMembership(db: SupabaseClient) {
  const {
    data: { user },
  } = await db.auth.getUser();
  const { data: membership } = await db
    .from('company_members')
    .select('role, company_id, companies(name, retention_days, plan, screen_assist)')
    .eq('user_id', user?.id ?? '')
    .limit(1)
    .maybeSingle();
  return {
    user,
    isOwner: membership?.role === 'owner',
    role: membership?.role ?? null,
    companyId: membership?.company_id ?? '',
    company: membership?.companies ?? null,
  };
}

/** A date, not a time: rendered on the server, a time would be in its zone. */
export function day(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { dateStyle: 'medium', timeZone: 'UTC' });
}
