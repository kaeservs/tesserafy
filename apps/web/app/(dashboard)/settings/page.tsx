import { RemoveMember } from '@/components/remove-member';
import { RetentionForm } from '@/components/retention-form';
import { PURGE_TIME_UTC, describeRetention } from '@/lib/retention';
import { createClient } from '@/lib/supabase/server';

export const metadata = { title: 'Settings · Tesserafy' };

/**
 * Company settings: how long calls are kept, and who can read them.
 *
 * Everyone in the company can see the period — it is a fact about their data
 * they are entitled to know. Only an owner is offered the form, because only
 * an owner may delete, and a retention period is deletion on a schedule.
 */
/** A date, not a time: rendered on the server, a time would be in its zone. */
function day(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { dateStyle: 'medium', timeZone: 'UTC' });
}

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

  // Addresses come through company_team(): auth.users is not readable by a
  // signed-in user, and the function returns this company's people only.
  const { data: team } = await supabase.rpc('company_team');
  // Only an owner can read these; for anyone else RLS returns none.
  const { data: removals } = isOwner
    ? await supabase
        .from('membership_removals')
        .select('email, role, removed_at')
        .order('removed_at', { ascending: false })
        .limit(10)
    : { data: [] };

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

      {/*
        Who can read these calls. Everyone sees it; only an owner removes.
        Adding someone creates an account, which this app cannot do and
        should not be able to — so it says who can.
      */}
      <section aria-labelledby="team-heading" className="card">
        <h2 id="team-heading" style={{ marginTop: 0 }}>
          Who has access
        </h2>
        <table className="team">
          <thead>
            <tr>
              <th>Person</th>
              <th>Role</th>
              <th>Joined</th>
              <th>Last signed in</th>
              {isOwner ? <th aria-label="Actions" /> : null}
            </tr>
          </thead>
          <tbody>
            {(team ?? []).map((person) => (
              <tr key={person.user_id}>
                <td>
                  {person.email}
                  {person.is_you ? <span className="muted"> (you)</span> : null}
                </td>
                <td>{person.role}</td>
                <td className="muted when">{day(person.joined_at)}</td>
                <td className="muted when">
                  {person.last_sign_in_at ? day(person.last_sign_in_at) : 'never'}
                </td>
                {isOwner ? (
                  <td>
                    {person.is_you ? null : <RemoveMember userId={person.user_id} email={person.email} />}
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted">
          Anyone removed loses access to every call at once; their account stays, with nothing in
          it. To add someone, ask Tesserafy support — accounts are created there for now.
        </p>
        {isOwner && (removals ?? []).length > 0 ? (
          <details>
            <summary>Removed recently</summary>
            <ul>
              {(removals ?? []).map((removal) => (
                <li key={`${removal.email}-${removal.removed_at}`} className="muted">
                  {removal.email} ({removal.role}), {day(removal.removed_at)}
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </section>
    </main>
  );
}
