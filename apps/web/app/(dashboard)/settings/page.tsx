import { RetentionForm } from '@/components/retention-form';
import { PURGE_TIME_UTC, describeRetention } from '@/lib/retention';
import { createClient } from '@/lib/supabase/server';

export const metadata = { title: 'Settings · Tesserafy' };

/**
 * Company settings. Today that is one thing: how long calls are kept.
 *
 * Everyone in the company can see the period — it is a fact about their data
 * they are entitled to know. Only an owner is offered the form, because only
 * an owner may delete, and a retention period is deletion on a schedule.
 */
export default async function SettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: membership } = await supabase
    .from('company_members')
    .select('role, companies(name, retention_days)')
    .eq('user_id', user?.id ?? '')
    .limit(1)
    .maybeSingle();

  const company = membership?.companies ?? null;
  const retention = company?.retention_days ?? null;
  const isOwner = membership?.role === 'owner';

  return (
    <main>
      <h1>Settings</h1>
      <section aria-labelledby="retention-heading" className="card">
        <h2 id="retention-heading" style={{ marginTop: 0 }}>
          How long calls are kept
        </h2>
        <p>
          <strong>{describeRetention(retention)}</strong>
        </p>
        <p className="muted">
          A call&apos;s age is counted from when the meeting took place, not when it was imported.
          Deletion runs every night at {PURGE_TIME_UTC} and removes the transcript with everything
          derived from it — the scorecard, signals, search index, and any insight only that call
          supported. A record that a call was deleted is kept; its contents are not. Tickets
          already exported to your tracker live there and are not deleted.
        </p>
        {isOwner ? (
          <RetentionForm current={retention} />
        ) : (
          <p className="muted">Only an owner of {company?.name ?? 'this company'} can change this.</p>
        )}
      </section>
    </main>
  );
}
