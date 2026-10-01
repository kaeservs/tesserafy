import type { AskPoint } from '@tesserafy/ai';

/**
 * A point of an answer to "Ask your calls", as the page shows it: the quote,
 * and where it was said — the call's page at that line, or the document.
 */
export interface AskedPoint {
  text: string;
  quote: string;
  /** Where it was said: the call's page at that line. */
  href: string | null;
  call: { title: string; occurredAt: string | null; startMs: number; speaker: string | null } | null;
  document: string | null;
}

export function shown(point: AskPoint): AskedPoint {
  return {
    text: point.text,
    quote: point.quote,
    href: point.call ? `/conversations/${point.call.conversationId}#segment-${point.call.segmentId}` : null,
    call: point.call
      ? { title: point.call.title, occurredAt: point.call.occurredAt, startMs: point.call.startMs, speaker: point.call.speaker }
      : null,
    document: point.document,
  };
}
