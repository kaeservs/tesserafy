import { DeleteMyAccount } from '@/components/delete-my-account';
import { PasswordForm } from '@/components/password-form';
import { liveSetup } from '@/lib/live-setup';
import { OVERLAY_ACCENTS, OVERLAY_MIN_OPACITY, OVERLAY_SIZES, OVERLAY_THEMES, readLook } from '@/lib/overlay-look';
import { createClient } from '@/lib/supabase/server';
import { chooseNextCall, saveDetectCalls, saveOverlayLook } from './overlay-actions';

export const metadata = { title: 'Account · Tesserafy' };

/**
 * The signed-in person's own account.
 *
 * An operator-created account arrives here from its invitation link with no
 * password, and is asked to choose one before anything else; everyone else
 * reaches it from their address in the header, to change theirs.
 */
export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<{ invited?: string; overlay?: string }>;
}) {
  const { invited, overlay: overlayNote } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: membership } = await supabase
    .from('company_members')
    .select('role, companies(name)')
    .eq('user_id', user?.id ?? '')
    .limit(1)
    .maybeSingle();

  const welcome = invited === '1';
  // Everything the overlay is told, set here rather than on it (lib/live-setup).
  const setup = user ? await liveSetup(supabase, user.id) : null;
  const look = readLook(setup?.look);

  return (
    <main>
      <h1>{welcome ? `Welcome to Tesserafy` : 'Your account'}</h1>
      <p className="muted">
        Signed in as <strong>{user?.email}</strong>
        {membership?.companies
          ? ` · ${membership.role} of ${membership.companies.name}`
          : ''}
      </p>
      <section aria-labelledby="password-heading" className="card">
        <h2 id="password-heading" style={{ marginTop: 0 }}>
          {welcome ? 'First, choose a password' : 'Password'}
        </h2>
        {welcome ? (
          <p className="muted">
            The link you followed works once. With a password you can sign in again from the sign-in
            page whenever you like.
          </p>
        ) : null}
        <PasswordForm invited={welcome} />
      </section>

      {welcome || !setup ? null : (
        <section aria-labelledby="overlay-heading" className="card">
          <h2 id="overlay-heading" style={{ marginTop: 0 }}>
            Overlay
          </h2>
          <p className="muted">
            The desktop overlay is set up here, not on the overlay: it shows only what you need during a call. Where it sits is
            each computer&apos;s own — drag it, or move it with Ctrl+Alt+Shift and the arrow keys.
          </p>
          <h3>Your next call</h3>
          {setup.prep ? (
            <p>
              <a href={`/prep/${setup.prep.id}`}>{setup.prep.person}</a>
              {setup.account ? `, ${setup.account.name}` : ''}
              {setup.prep.callAt
                ? ` · ${new Date(setup.prep.callAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' })} UTC`
                : ''}
              <span className="muted"> · {setup.prep.chosen ? 'chosen by you' : 'your prep with the nearest call'}</span>
              {setup.prep.chosen ? (
                <form action={chooseNextCall} className="inline-form">
                  <input type="hidden" name="back" value="/account" />{' '}
                  <button type="submit" className="link-button">
                    Clear
                  </button>
                </form>
              ) : null}
            </p>
          ) : (
            <p className="muted">
              None. Prepare a call under <a href="/prep">Prepare</a> and choose <em>Use for my next call</em>, or give it a time: the
              overlay takes its customer, scorecard and questions from it.
            </p>
          )}
          <h3>When a call starts</h3>
          <form action={saveDetectCalls} className="inline-form">
            <input type="hidden" name="on" value={setup.detectCalls ? 'off' : 'on'} />
            <p>
              {setup.detectCalls
                ? 'The overlay comes up by itself when Zoom, Teams, Webex, Slack or your browser starts using your microphone, and offers Start.'
                : 'The overlay stays where it is when a call starts; bring it up yourself.'}{' '}
              <button type="submit" className="link-button">
                {setup.detectCalls ? 'Switch off' : 'Switch on'}
              </button>
            </p>
            <p className="muted" style={{ fontSize: '0.8rem' }}>
              It never starts listening by itself: you confirm everyone agreed, then press Start. On Windows; on a Mac this comes
              later.
            </p>
          </form>
          <h3>How it looks</h3>
          <form action={saveOverlayLook} className="overlay-look">
            <label>
              Theme{' '}
              <select name="theme" defaultValue={look.theme}>
                {OVERLAY_THEMES.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Accent{' '}
              <select name="accent" defaultValue={look.accent}>
                {OVERLAY_ACCENTS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Size{' '}
              <select name="size" defaultValue={look.size}>
                {OVERLAY_SIZES.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Background{' '}
              <input type="number" name="opacity" min={OVERLAY_MIN_OPACITY} max={100} step={1} defaultValue={look.opacity} aria-describedby="opacity-note" />
              %
            </label>
            <button type="submit">Save how it looks</button>
          </form>
          <p className="muted" id="opacity-note" style={{ fontSize: '0.8rem' }}>
            The background fades to {OVERLAY_MIN_OPACITY}% at most; the text never does. The overlay picks up a change when it next
            starts a call.
          </p>
          {overlayNote ? (
            <p role="status" className="muted">
              {overlayNote === 'saved' ? 'Saved.' : overlayNote}
            </p>
          ) : null}
        </section>
      )}

      {welcome ? null : (
        <section aria-labelledby="delete-account-heading" className="card">
          <h2 id="delete-account-heading" style={{ marginTop: 0 }}>
            Delete your account
          </h2>
          {membership?.role === 'owner' ? (
            <p className="muted" style={{ marginBottom: 0 }}>
              You own {membership.companies?.name ?? 'your company'}, and a company needs an owner. To
              delete your account, first make someone else an owner and step down to member, under{' '}
              <a href="/settings">Settings → Who has access</a>; then this page offers it. If you are
              the only person in the company, ask Tesserafy to close it instead, which deletes its
              calls.
            </p>
          ) : (
            <DeleteMyAccount email={user?.email ?? ''} company={membership?.companies?.name ?? null} />
          )}
        </section>
      )}
    </main>
  );
}
