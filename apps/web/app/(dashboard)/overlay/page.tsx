import Link from 'next/link';
import { latestOverlay, RELEASES_PAGE } from '@/lib/overlay-release';

export const metadata = { title: 'Get the overlay · Tesserafy' };

/**
 * Where a seller gets the overlay: the newest release's installers, what it
 * does, and where its settings live (here, in the dashboard — the overlay
 * itself has as few controls as possible).
 */
export default async function OverlayPage() {
  const release = await latestOverlay();
  return (
    <main className="wide">
      <h1>Get the overlay</h1>
      <p className="muted">
        A small window that sits over your meeting — Zoom, Teams, Meet in a browser — and only you can see. It scores the
        call as it happens, answers Assist, What should I say?, Follow-up questions and Recap, and before a call answers
        questions about your past calls with that customer. No bot joins the meeting. On Incognito it never appears
        in a screen share; on the other plans it shows if you share your screen.
      </p>

      <section className="card" aria-labelledby="download-heading">
        <h2 id="download-heading">Download{release ? ` version ${release.version}` : ''}</h2>
        {release && release.downloads.length > 0 ? (
          <>
            <div className="grid">
              {release.downloads.map((download) => (
                <a key={download.url} className="download" href={download.url}>
                  <strong>{download.label}</strong>
                  <span className="muted">{download.sizeMb} MB</span>
                </a>
              ))}
            </div>
            <p className="muted">
              Not code-signed yet: Windows may say the publisher is unknown — choose More info, then Run anyway. On a Mac,
              open it with right-click → Open the first time.
            </p>
          </>
        ) : (
          <p>
            The newest installers are on the <a href={RELEASES_PAGE}>releases page</a>.
          </p>
        )}
      </section>

      <section className="card" aria-labelledby="setup-heading">
        <h2 id="setup-heading">Set it up here, not in the overlay</h2>
        <ul>
          <li>
            How it looks — theme, colour, size: <Link href="/account#overlay-heading">Your account → Overlay</Link>.
          </li>
          <li>
            Who your next call is with, its scorecard and questions: mark a call prep{' '}
            <Link href="/prep">“Use for my next call”</Link>.
          </li>
          <li>
            What it answers product questions from: your company&apos;s <Link href="/knowledge">Knowledge</Link>.
          </li>
          <li>
            The first time you start a call, it asks you once to agree to tell everyone on every call you record.
          </li>
        </ul>
      </section>
    </main>
  );
}
