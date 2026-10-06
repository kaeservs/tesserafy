import { PlanPanel, type CatalogPlan, type PlanOverview } from '@/components/plan-panel';
import { billingMode } from '@/lib/billing';
import { liveCallsAvailable } from '@/lib/company';
import { myMembership } from '@/lib/membership';
import { createClient } from '@/lib/supabase/server';

export const metadata = { title: 'Membership · Tesserafy' };

/**
 * The plan the company is on, what is left of it, and the plans it could move
 * to. Owners change it here (upgrade now, move down or cancel at the period's
 * end, or Stripe's billing page once paying); a plan is the company's, so a
 * member sees it and who can change it.
 */
export default async function MembershipPage({ searchParams }: { searchParams: Promise<{ billing?: string }> }) {
  const supabase = await createClient();
  const me = await myMembership(supabase);
  // Rolled over first if a period ended, so this never shows a trial that has already run out.
  const [{ data: overview }, { data: catalog }, { data: team }, billing, { billing: returned }] = await Promise.all([
    supabase.rpc('plan_overview'),
    supabase
      .from('plans')
      .select('id, name, price_usd_cents, rank, incognito, calls, extractions, pattern_runs, questions, live_minutes')
      .eq('self_serve', true)
      .order('rank'),
    supabase.rpc('company_team'),
    me.companyId ? billingMode(supabase, me.companyId) : Promise.resolve('free' as const),
    searchParams,
  ]);
  const owners = (team ?? []).filter((person) => person.role === 'owner' && !person.is_you).map((person) => person.email);

  return (
    <section aria-labelledby="membership-heading" className="card">
      <h2 id="membership-heading" style={{ marginTop: 0 }}>
        Your membership
      </h2>
      {overview ? (
        <PlanPanel
          overview={overview as unknown as PlanOverview}
          catalog={(catalog ?? []) as CatalogPlan[]}
          isOwner={me.isOwner}
          liveAvailable={liveCallsAvailable(me.company?.plan)}
          billing={billing}
          returnedFromCheckout={returned === 'started'}
          owners={owners}
        />
      ) : (
        <p className="muted">The plan could not be read just now.</p>
      )}
    </section>
  );
}
