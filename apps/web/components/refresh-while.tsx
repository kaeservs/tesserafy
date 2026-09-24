'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

/**
 * Re-render the page from the server every few seconds while something is
 * expected to change.
 *
 * Used while a just-uploaded call is being scored: the scorecard is computed
 * on read, so a refresh is all it takes for it to appear, and asking somebody
 * to reload by hand is asking them to guess when. It stops on its own, because
 * the server stops rendering it the moment the state it was waiting for has
 * arrived — and after a hard ceiling regardless, so a pass that never finishes
 * cannot keep a tab polling forever.
 */
export function RefreshWhile({
  everyMs = 5_000,
  forMs = 10 * 60_000,
}: {
  everyMs?: number;
  forMs?: number;
}) {
  const router = useRouter();

  useEffect(() => {
    const started = Date.now();
    const timer = window.setInterval(() => {
      if (Date.now() - started > forMs) {
        window.clearInterval(timer);
        return;
      }
      router.refresh();
    }, everyMs);
    return () => window.clearInterval(timer);
  }, [router, everyMs, forMs]);

  return null;
}
