import { TableScroll } from '@/components/table-scroll';
import { ChangeRole } from '@/components/change-role';
import type { PlanOverview } from '@/components/plan-panel';
import { RemoveMember } from '@/components/remove-member';
import { RequestTeammate } from '@/components/request-teammate';
import { day, myMembership } from '@/lib/membership';
import { createClient } from '@/lib/supabase/server';

export const metadata = { title: 'Team · Tesserafy' };

/**
 * Who can read these calls. Everyone sees it; only an owner removes. Adding
 * someone creates an account, which this app cannot do and should not be able
 * to — so an owner asks, and Tesserafy adds them.
 */
export default async function TeamPage() {
  const supabase = await createClient();
  const { isOwner, companyId } = await myMembership(supabase);

  // Addresses come through company_team(): auth.users is not readable by a
  // signed-in user, and the function returns this company's people only.
  const [{ data: team }, { data: overview }, { data: requests }, { data: removals }, { data: roleChanges }] = await Promise.all([
    supabase.rpc('company_team'),
    supabase.rpc('plan_overview'),
    isOwner
      ? supabase
          .from('access_requests')
          .select('id, email, role, created_at, resolution, resolution_note, resolved_at')
          .eq('company_id', companyId)
          .order('created_at', { ascending: false })
          .limit(10)
      : Promise.resolve({ data: [] }),
    // Only an owner can read these; for anyone else RLS returns none.
    isOwner
      ? supabase
          .from('membership_removals')
          .select('email, role, removed_at')
          .eq('company_id', companyId)
          .order('removed_at', { ascending: false })
          .limit(10)
      : Promise.resolve({ data: [] }),
    isOwner
      ? supabase
          .from('membership_role_changes')
          .select('id, email, to_role, changed_at')
          .eq('company_id', companyId)
          .order('changed_at', { ascending: false })
          .limit(10)
      : Promise.resolve({ data: [] }),
  ]);
  // Nobody joins without a seat (ADR 0027): with every seat taken, counting
  // requests still waiting, a request could not be granted, so it says so first.
  const plan = overview as unknown as PlanOverview | null;
  const waitingRequests = (requests ?? []).filter((request) => request.resolution === null).length;
  const seatLimit = plan?.seat_limit ?? null;
  const seatsFull = seatLimit !== null && (plan?.members ?? 1) + waitingRequests >= seatLimit;
  // The last owner cannot step down; the button is not offered when it would only be refused.
  const owners = (team ?? []).filter((person) => person.role === 'owner').length;

  return (
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
                <td className="muted when">{person.last_sign_in_at ? day(person.last_sign_in_at) : 'never'}</td>
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
        Anyone removed loses access to every call at once; their account stays, with nothing in it.
        {isOwner
          ? ' To add someone, ask below: Tesserafy creates the account and sends them a sign-in link.'
          : ' To add someone, ask an owner of your company.'}
      </p>
      {isOwner ? (
        <>
          <RequestTeammate seatsFull={seatsFull ? { free: plan?.plan === 'free', waiting: waitingRequests } : null} />
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
                {change.email} became {change.to_role === 'owner' ? 'an owner' : 'a member'}, {day(change.changed_at)}
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
  );
}
