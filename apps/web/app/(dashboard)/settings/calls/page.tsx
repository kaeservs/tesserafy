import { RetentionForm } from '@/components/retention-form';
import { myMembership } from '@/lib/membership';
import { PURGE_TIME_UTC, describeRetention } from '@/lib/retention';
import { createClient } from '@/lib/supabase/server';
import { setScreenAssist } from '../actions';

export const metadata = { title: 'Calls · Tesserafy' };

/**
 * What happens to the company's calls: whether a seller may ask about their
 * screen, and how long calls are kept. Everyone sees both — they are facts
 * about their data they are entitled to know. Only an owner is offered the
 * forms, because only an owner may delete, and a retention period is deletion
 * on a schedule.
 */
export default async function CallsSettingsPage() {
  const supabase = await createClient();
  const { isOwner, company } = await myMembership(supabase);
  const retention = company?.retention_days ?? null;

  return (
    <>
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
          A call&apos;s age is counted from when the meeting took place, not when it was imported. Deletion runs every night
          at {PURGE_TIME_UTC} and removes the transcript with everything derived from it — the scorecard, signals, search
          index, and any insight only that call supported. A record that a call was deleted is kept; its contents are not.
          Tickets already exported to your tracker live there and are not deleted.
        </p>
        {isOwner ? (
          <RetentionForm current={retention} />
        ) : (
          <p className="muted">Only an owner of {company?.name ?? 'this company'} can change this.</p>
        )}
      </section>
    </>
  );
}
