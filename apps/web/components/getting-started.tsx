import Link from 'next/link';
import { SampleCallButton } from '@/components/sample-call-button';

/**
 * What an empty company does first.
 *
 * A pilot's first sign-in lands on pages with nothing in them, and an empty
 * page that only says "nothing yet" leaves them to guess what fills it. The
 * three steps are the product's actual loop, in the words of its buttons, and
 * say which parts happen by themselves — so nobody waits on a step that is
 * already running, or presses for one that needs no pressing.
 */
export function GettingStarted({ offerSample = false }: { offerSample?: boolean }) {
  return (
    <div className="card">
      <h2 style={{ marginTop: 0 }}>Getting started</h2>
      {offerSample ? (
        <>
          <p>No transcript to hand yet? See what a scored call looks like first.</p>
          <SampleCallButton />
          <p className="muted" style={{ marginBottom: 0 }}>Then, with your own calls:</p>
        </>
      ) : null}
      <ol>
        <li>
          <Link href="/conversations/new">Import a transcript</Link> — the transcript Zoom, Meet
          or Teams exports, or a text export from Otter or Fireflies. It is scored against your criteria and indexed for search on its own,
          usually within a couple of minutes.
        </li>
        <li>
          Open the call and press <strong>Find insights in this call</strong> to pull out the
          problems the customer raised and what they asked for, each quoted word for word.
        </li>
        <li>
          Once a few calls have been read, <strong>Look for patterns</strong> under Insights groups
          what comes up in more than one, for you to approve.
        </li>
      </ol>
    </div>
  );
}
