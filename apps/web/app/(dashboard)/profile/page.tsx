import Link from 'next/link';
import { NameForm } from '@/components/name-form';
import { PlanPanel, type CatalogPlan, type PlanOverview } from '@/components/plan-panel';
import { billingMode } from '@/lib/billing';
import { liveAvailable } from '@/lib/company';
import { createClient } from '@/lib/supabase/server';

/**
 * Your profile: who you are, and your membership — the plan your company is
 * on, what is left of it, and the plans you could move to. Owners change it
 * here (upgrade now, move down or cancel at the period's end, or Stripe's
 * billing page once paying); a plan is the company's, so a member sees it and
 * who can change it. The overlay, calendar and password are on Account.
 */
export default async function ProfilePage({ searchParams }: { searchParams: Promise<{ billing?: string }> }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const [{ data: membership }, { data: preferences }, { data: overview }, { data: catalog }, { data: team }, { billing: returned }] =
    await Promise.all([
      supabase.from('company_members').select('company_id, role, companies(name, plan)').eq('user_id', user?.id ?? '').limit(1).maybeSingle(),
      supabase.from('user_preferences').select('display_name').eq('user_id', user?.id ?? '').maybeSingle(),
      supabase.rpc('plan_overview'),
      supabase
        .from('plans')
        .select('id, name, price_usd_cents, calls, extractions, pattern_runs, questions, live_minutes')
        .eq('self_serve', true)
        .order('rank'),
      supabase.rpc('company_team'),
      searchParams,
    ]);
  const isOwner = membership?.role === 'owner';
  const billing = membership ? await billingMode(supabase, membership.company_id) : 'free';
  const owners = (team ?? []).filter((person) => person.role === 'owner' && !person.is_you).map((person) => person.email);

  return (
    <main>
      <h1>Your profile</h1>

      <section aria-labelledby="you-heading" className="card">
        <h2 id="you-heading" style={{ marginTop: 0 }}>
          You
        </h2>
        <NameForm name={preferences?.display_name ?? ''} />
        <p className="muted">
          Shown in Tesserafy, and the name your follow-up emails go out under unless you type another.
        </p>
        <p>
          Signed in as <strong>{user?.email}</strong>
          {membership?.companies ? ` · ${membership.role === 'owner' ? 'Owner' : 'Member'} of ${membership.companies.name}` : ''}
        </p>
        <p className="muted" style={{ marginBottom: 0 }}>
          Your password, the overlay and your calendar are on <Link href="/account">your account</Link>.
        </p>
      </section>

      <section aria-labelledby="membership-heading" className="card">
        <h2 id="membership-heading" style={{ marginTop: 0 }}>
          Your membership
        </h2>
        {overview ? (
          <PlanPanel
            overview={overview as unknown as PlanOverview}
            catalog={(catalog ?? []) as CatalogPlan[]}
            isOwner={isOwner}
            liveAvailable={liveAvailable(membership?.companies?.plan)}
            billing={billing}
            returnedFromCheckout={returned === 'started'}
            page="/profile"
            owners={owners}
          />
        ) : (
          <p className="muted">The plan could not be read just now.</p>
        )}
      </section>
    </main>
  );
}
