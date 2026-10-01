import { TableScroll } from '@/components/table-scroll';
import { ChangeRole } from '@/components/change-role';
import { PlanPanel, type CatalogPlan, type PlanOverview } from '@/components/plan-panel';
import { liveAvailable } from '@/lib/company';
import { RemoveMember } from '@/components/remove-member';
import { RequestTeammate } from '@/components/request-teammate';
import { RetentionForm } from '@/components/retention-form';
import { TrackerPanel } from '@/components/tracker-panel';
import { PURGE_TIME_UTC, describeRetention } from '@/lib/retention';
import { createClient } from '@/lib/supabase/server';
import { setScreenAssist } from './actions';
import { trackerKeyAvailable } from '@/lib/tracker-secret';
import { isProvider } from '@/lib/trackers';

export const metadata = { title: 'Settings · Tesserafy' };

/**
 * Company settings: the plan, how long calls are kept, and who can read them.
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
    .select('role, company_id, companies(name, retention_days, plan, screen_assist)')
    .eq('user_id', user?.id ?? '')
    .limit(1)
    .maybeSingle();

  const company = membership?.companies ?? null;
  const retention = company?.retention_days ?? null;
  const isOwner = membership?.role === 'owner';
  // Named on every read below: an operator is a member too, and operators may
  // read these tables across every company (the lesson of 20261002090000).
  const companyId = membership?.company_id ?? '';

  // Where the company stands on its plan; rolled over first if a period
  // ended, so this never shows a trial that has already run out.
  const [{ data: overview }, { data: catalog }] = await Promise.all([
    supabase.rpc('plan_overview'),
    supabase
      .from('plans')
      .select('id, name, price_usd_cents, calls, extractions, pattern_runs, questions, live_minutes')
      .eq('self_serve', true)
      .order('rank'),
  ]);

  // Addresses come through company_team(): auth.users is not readable by a
  // signed-in user, and the function returns this company's people only.
  const { data: team } = await supabase.rpc('company_team');
  const { data: requests } = isOwner
    ? await supabase
        .from('access_requests')
        .select('id, email, role, created_at, resolution, resolution_note, resolved_at')
        .eq('company_id', companyId)
        .order('created_at', { ascending: false })
        .limit(10)
    : { data: [] };
  const { data: exports } = isOwner
    ? await supabase
        .from('company_exports')
        .select('email, conversations, requested_at')
        .eq('company_id', companyId)
        .order('requested_at', { ascending: false })
        .limit(5)
    : { data: [] };
  // Only an owner can read these; for anyone else RLS returns none.
  const { data: removals } = isOwner
    ? await supabase
        .from('membership_removals')
        .select('email, role, removed_at')
        .eq('company_id', companyId)
        .order('removed_at', { ascending: false })
        .limit(10)
    : { data: [] };
  const { data: roleChanges } = isOwner
    ? await supabase
        .from('membership_role_changes')
        .select('id, email, to_role, changed_at')
        .eq('company_id', companyId)
        .order('changed_at', { ascending: false })
        .limit(10)
    : { data: [] };
  // Where tickets go. Every member may read this; the token itself is a
  // column no customer can select (ADR 0015).
  const { data: tracker } = await supabase
    .from('company_trackers')
    .select('provider, target, token_hint, connected_by, connected_at')
    .eq('company_id', companyId)
    .maybeSingle();
  const emailOf = new Map((team ?? []).map((person) => [person.user_id, person.email]));

  // The last owner cannot step down; the button is not offered when it would
  // only be refused.
  const owners = (team ?? []).filter((person) => person.role === 'owner').length;

  return (
    <main>
      <h1>Settings</h1>
      <section aria-labelledby="plan-heading" className="card">
        <h2 id="plan-heading" style={{ marginTop: 0 }}>
          Plan
        </h2>
        {overview ? (
          <PlanPanel
            overview={overview as unknown as PlanOverview}
            catalog={(catalog ?? []) as CatalogPlan[]}
            isOwner={isOwner}
            liveAvailable={liveAvailable(company?.plan)}
          />
        ) : (
          <p className="muted">The plan could not be read just now.</p>
        )}
      </section>

      <section aria-labelledby="screen-heading" className="card">
        <h2 id="screen-heading" style={{ marginTop: 0 }}>
          Ask about your screen
        </h2>
        <p>
          <strong>{company?.screen_assist === false ? 'Off' : 'On'}</strong>
        </p>
        <p className="muted">
          In the overlay, a seller can send a screenshot with a question — their screen, as it is, the moment they press. It
          goes to the AI for that one answer and is never stored. Nothing is ever captured without a press. Switch it off if
          your company does not allow a picture of the screen to leave the computer.
        </p>
        {isOwner ? (
          <form action={setScreenAssist} className="inline-form">
            <input type="hidden" name="allowed" value={company?.screen_assist === false ? 'on' : 'off'} />
            <button type="submit">{company?.screen_assist === false ? 'Switch it on' : 'Switch it off'}</button>
          </form>
        ) : (
          <p className="muted">Only an owner of {company?.name ?? 'this company'} can change this.</p>
        )}
      </section>

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
        <TableScroll label="Team">
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
                      <div className="toolbar" style={{ flexWrap: 'wrap' }}>
                        {person.role === 'member' ? (
                          <ChangeRole userId={person.user_id} email={person.email} to="owner" isYou={person.is_you} />
                        ) : owners > 1 ? (
                          <ChangeRole userId={person.user_id} email={person.email} to="member" isYou={person.is_you} />
                        ) : null}
                        {person.is_you ? null : <RemoveMember userId={person.user_id} email={person.email} />}
                      </div>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
        <p className="muted">
          Anyone removed loses access to every call at once; their account stays, with nothing in
          it.
          {isOwner
            ? ' To add someone, ask below: Tesserafy creates the account and sends them a sign-in link.'
            : ' To add someone, ask an owner of your company.'}
        </p>
        {isOwner ? (
          <>
            <RequestTeammate />
            {(requests ?? []).length > 0 ? (
              <ul className="muted">
                {(requests ?? []).map((request) => (
                  <li key={request.id}>
                    {request.email} ({request.role}), asked {day(request.created_at)} —{' '}
                    {request.resolution === 'added'
                      ? `added ${request.resolved_at ? day(request.resolved_at) : ''}`
                      : request.resolution === 'declined'
                        ? `declined: ${request.resolution_note ?? ''}`
                        : 'waiting for Tesserafy'}
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        ) : null}
        {isOwner && (roleChanges ?? []).length > 0 ? (
          <details>
            <summary>Role changes</summary>
            <ul>
              {(roleChanges ?? []).map((change) => (
                <li key={change.id} className="muted">
                  {change.email} became {change.to_role === 'owner' ? 'an owner' : 'a member'},{' '}
                  {day(change.changed_at)}
                </li>
              ))}
            </ul>
          </details>
        ) : null}
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

      {/*
        The whole company's data as one file, for the owner: before a pilot
        ends, or when someone asks what is held about them. A plain link, so
        the browser saves it like any other download.
      */}
      {isOwner ? (
        <section aria-labelledby="export-heading" className="card">
          <h2 id="export-heading" style={{ marginTop: 0 }}>
            Take a copy of your data
          </h2>
          <p className="muted">
            One JSON file with every call&apos;s transcript, the quoted evidence behind its score,
            the signals and insights read from it, your team, and the log of deleted calls. Each
            export is recorded here, with who took it.
          </p>
          {/* A form, not a link: a link can be followed from any other site
              with the owner's session, and each export is recorded. */}
          <form method="post" action="/api/export">
            <p>
              <button type="submit" className="link-button">
                Download everything
              </button>
            </p>
          </form>
          {(exports ?? []).length > 0 ? (
            <ul className="muted" style={{ marginBottom: 0 }}>
              {(exports ?? []).map((row) => (
                <li key={row.requested_at}>
                  {row.email}, {day(row.requested_at)} — {row.conversations} call
                  {row.conversations === 1 ? '' : 's'}
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}
    </main>
  );
}
