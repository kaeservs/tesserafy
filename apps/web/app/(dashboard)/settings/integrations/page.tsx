import { CrmPanel } from '@/components/crm-panel';
import { TrackerPanel } from '@/components/tracker-panel';
import { crmKeyAvailable } from '@/lib/crm';
import { day, myMembership } from '@/lib/membership';
import { createClient } from '@/lib/supabase/server';
import { trackerKeyAvailable } from '@/lib/tracker-secret';
import { isProvider } from '@/lib/trackers';

export const metadata = { title: 'Integrations · Tesserafy' };

/**
 * Where the company's work goes outside Tesserafy: tickets to its tracker
 * (ADR 0015) and calls to its CRM (ADR 0024). Every member may read where;
 * the tokens are columns no customer can select.
 */
export default async function IntegrationsPage() {
  const supabase = await createClient();
  const { isOwner, companyId } = await myMembership(supabase);
  const [{ data: tracker }, { data: crm }, { data: team }] = await Promise.all([
    supabase
      .from('company_trackers')
      .select('provider, target, token_hint, connected_by, connected_at')
      .eq('company_id', companyId)
      .maybeSingle(),
    supabase
      .from('company_crms')
      .select('account_ref, token_hint, connected_by, connected_at, last_error')
      .eq('company_id', companyId)
      .maybeSingle(),
    supabase.rpc('company_team'),
  ]);
  const emailOf = new Map((team ?? []).map((person) => [person.user_id, person.email]));

  return (
    <>
      <section aria-labelledby="tracker-heading" className="card">
        <h2 id="tracker-heading" style={{ marginTop: 0 }}>
          Where tickets go
        </h2>
        <TrackerPanel
          connected={
            tracker
              ? {
                  provider: isProvider(tracker.provider) ? tracker.provider : 'github',
                  target: tracker.target,
                  tokenHint: tracker.token_hint,
                  connectedBy: tracker.connected_by ? (emailOf.get(tracker.connected_by) ?? 'a former member') : null,
                  connectedAt: tracker.connected_at,
                }
              : null
          }
          connectedDate={tracker ? day(tracker.connected_at) : null}
          isOwner={isOwner}
          available={trackerKeyAvailable()}
        />
      </section>

      <section aria-labelledby="crm-heading" className="card">
        <h2 id="crm-heading" style={{ marginTop: 0 }}>
          Where calls are logged
        </h2>
        <CrmPanel
          connected={
            crm
              ? {
                  accountRef: crm.account_ref,
                  tokenHint: crm.token_hint,
                  connectedBy: crm.connected_by ? (emailOf.get(crm.connected_by) ?? 'a former member') : null,
                  lastError: crm.last_error,
                }
              : null
          }
          connectedDate={crm ? day(crm.connected_at) : null}
          isOwner={isOwner}
          available={crmKeyAvailable()}
        />
      </section>
    </>
  );
}
