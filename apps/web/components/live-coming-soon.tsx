import Link from 'next/link';

/** What a brand sees at a live page before live scorecards launch. */
export function LiveComingSoon() {
  return (
    <main style={{ maxWidth: '36rem' }}>
      <h1>Live scorecards are coming soon</h1>
      <p>
        A scorecard that fills in while the call is happening, with a suggestion for what to ask
        next. It is not open yet: it will launch once live transcription runs entirely on
        infrastructure Tesserafy controls, so your calls&apos; audio goes nowhere else.
      </p>
      <p className="muted">
        Until then, <Link href="/conversations/new">import a transcript</Link> after the call and
        it is scored within a couple of minutes.
      </p>
    </main>
  );
}
