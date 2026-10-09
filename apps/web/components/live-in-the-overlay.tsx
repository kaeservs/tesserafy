import Link from 'next/link';

/**
 * What a customer sees at a live page. Live calls run in the desktop overlay,
 * which hears both sides through Deepgram (ADR 0022); this browser page is
 * Tesserafy's own test bench, on the browser's speech recognition, which
 * sends the audio to the browser's vendor and so is never for a customer's
 * call (lib/company, liveAvailable).
 */
export function LiveInTheOverlay() {
  return (
    <main style={{ maxWidth: '36rem' }}>
      <h1>Live calls run in the overlay</h1>
      <p>
        The scorecard that fills in while the customer talks, and what to say next, are in the Tesserafy overlay. It sits over
        Zoom, Teams or Google Meet, hears both sides of the call, and keeps the call here when it ends.
      </p>
      <p>
        <Link href="/overlay">Get the overlay</Link>
      </p>
      <p className="muted">
        Or <Link href="/conversations/new">import a transcript</Link> after the call, and it is scored within a couple of
        minutes.
      </p>
    </main>
  );
}
