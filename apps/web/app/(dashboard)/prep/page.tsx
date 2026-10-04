import Link from 'next/link';
import { fetchCriteriaSets } from '@tesserafy/db';
import { PrepForm } from '@/components/prep-form';
import { engagementLabel, myCompanyId } from '@/lib/company';
import { PREP_COLUMNS, readBrief, type PrepRow } from '@/lib/prep';
import { researchAvailable } from '@/lib/apify';
import { createClient } from '@/lib/supabase/server';
import { syncCalendars } from '@/lib/calendar-sync';
import { prepareFromEvent } from './calendar-actions';

export const metadata = { title: 'Prepare · Tesserafy' };

function when(iso: string | null): string {
  if (!iso) return 'no time set';
  return new Date(iso).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }) + ' UTC';
}

/**
 * Prepare for a call: who it is with, what their profile says, and a brief —
 * what to ask, aimed at what is still to find out with their company, and
 * what they have already said. Coming up first, then the rest.
 */
export default async function PrepPage({ searchParams }: { searchParams: Promise<{ account?: string }> }) {
  const { account } = await searchParams;
  const supabase = await createClient();
  const companyId = await myCompanyId(supabase);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  // The calendar, read again if it has not been for a while (lib/calendar-sync).
  if (user) await syncCalendars(supabase, user.id);
  const { data: meetings } = await supabase
    .from('calendar_events')
    .select('id, title, starts_at, attendees, meeting_url, prep_id')
    .gte('ends_at', new Date().toISOString())
    .order('starts_at')
    .limit(20);
  const [{ data: preps }, { data: accounts }, sets] = await Promise.all([
    supabase.from('call_preps').select(PREP_COLUMNS).order('call_at', { ascending: true, nullsFirst: false }).limit(200).returns<PrepRow[]>(),
    supabase.from('accounts').select('id, name').order('name').limit(500),
    fetchCriteriaSets(supabase, companyId),
  ]);
  const scorecards = [...new Set(sets.map((set) => set.engagementType))].map((type) => ({ value: type, label: engagementLabel(type) }));
  const accountName = new Map((accounts ?? []).map((row) => [row.id, row.name]));
  const now = Date.now() - 3_600_000;
  const upcoming = (preps ?? []).filter((prep) => prep.call_at === null || Date.parse(prep.call_at) >= now);
  const earlier = (preps ?? [])
    .filter((prep) => prep.call_at !== null && Date.parse(prep.call_at) < now)
    .sort((a, b) => (b.call_at ?? '').localeCompare(a.call_at ?? ''))
    .slice(0, 20);

  const list = (rows: PrepRow[]) => (
    <ul className="meetings">
      {rows.map((prep) => (
        <li key={prep.id} className="meeting">
          <Link href={`/prep/${prep.id}`} className="meeting-title">
            {prep.person_name}
            {prep.account_id && accountName.has(prep.account_id) ? `, ${accountName.get(prep.account_id)}` : ''}
          </Link>
          <span className="meeting-meta">
            {when(prep.call_at)}
            {prep.person_title ? ` · ${prep.person_title}` : ''}
          </span>
          <span className="meeting-score">
            {readBrief(prep.brief) ? <span className="muted">brief ready</span> : <span className="muted">no brief yet</span>}
          </span>
        </li>
      ))}
    </ul>
  );

  return (
    <main>
      <h1>Prepare for a call</h1>
      <p className="muted">
        Say who you are meeting and paste what their LinkedIn profile says. The brief quotes their profile, aims its questions
        at what you have not yet found out with their company, and reminds you what they said last time.
      </p>
      {(meetings ?? []).length > 0 ? (
        <section aria-labelledby="calendar-heading" className="card">
          <h2 id="calendar-heading" style={{ marginTop: 0 }}>
            From your calendar
          </h2>
          <table>
            <thead>
              <tr>
                <th>Meeting</th>
                <th>With</th>
                <th>When</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(meetings ?? []).map((meeting) => {
                const people = Array.isArray(meeting.attendees)
                  ? (meeting.attendees as { email?: string; name?: string | null }[]).map((a) => a.name || a.email).filter(Boolean)
                  : [];
                return (
                  <tr key={meeting.id}>
                    <td>{meeting.title}</td>
                    <td className="muted">
                      {people.slice(0, 2).join(', ')}
                      {people.length > 2 ? ` +${people.length - 2}` : ''}
                    </td>
                    <td className="muted">{when(meeting.starts_at)}</td>
                    <td>
                      {meeting.prep_id ? (
                        <Link href={`/prep/${meeting.prep_id}`}>Open prep</Link>
                      ) : (
                        <form action={prepareFromEvent} className="inline-form">
                          <input type="hidden" name="eventId" value={meeting.id} />
                          <button type="submit">Prepare</button>
                        </form>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      ) : (
        <p className="muted">
          <Link href="/account#calendar-heading">Connect your calendar</Link> and your upcoming customer meetings appear here,
          one click from a prep.
        </p>
      )}
      <section className="card">
        <PrepForm initial={{ accountId: account ?? null }} accounts={accounts ?? []} scorecards={scorecards} researchReady={researchAvailable()} />
      </section>
      <section aria-labelledby="upcoming-heading">
        <h2 id="upcoming-heading">Coming up</h2>
        {upcoming.length === 0 ? <p className="muted">Nothing prepared yet.</p> : list(upcoming)}
      </section>
      {earlier.length > 0 ? (
        <section aria-labelledby="earlier-heading">
          <h2 id="earlier-heading">Earlier</h2>
          {list(earlier)}
        </section>
      ) : null}
    </main>
  );
}
