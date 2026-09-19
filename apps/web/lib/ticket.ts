/**
 * What a ticket says.
 *
 * The body is built from the insight's own citation chain, not from a summary
 * of it: every quote here is one a detector verified against its segment, with
 * the customer who said it and when. An engineer reading the ticket in three
 * weeks can check the claim without opening this product.
 *
 * Pure on purpose — the interesting part is the wording, and wording is worth
 * testing.
 */

export interface TicketCitation {
  readonly quote: string;
  readonly conversationTitle: string;
  readonly conversationId: string;
  readonly segmentId: string;
  readonly startMs: number;
  readonly speaker: string | null;
}

export interface TicketInput {
  readonly title: string;
  readonly summary: string;
  readonly citations: readonly TicketCitation[];
  /** Absolute, so the link works from a tracker nobody signed into yet. */
  readonly insightUrl: string;
}

function clock(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(totalSeconds / 60)).padStart(2, '0')}:${String(totalSeconds % 60).padStart(2, '0')}`;
}

export function ticketTitle(input: TicketInput): string {
  return input.title.trim();
}

export function ticketBody(input: TicketInput): string {
  const conversations = new Set(input.citations.map((citation) => citation.conversationId));

  const evidence = input.citations
    .map((citation) => {
      const who = citation.speaker ? `${citation.speaker}, ` : '';
      const link = `${new URL(input.insightUrl).origin}/conversations/${citation.conversationId}#segment-${citation.segmentId}`;
      return `- “${citation.quote}”\n  — ${who}${citation.conversationTitle} at ${clock(citation.startMs)} ([transcript](${link}))`;
    })
    .join('\n');

  return `${input.summary.trim()}

## Evidence

${input.citations.length} quote${input.citations.length === 1 ? '' : 's'} from ${conversations.size} conversation${conversations.size === 1 ? '' : 's'}:

${evidence}

---

Raised from [an insight in Tesserafy](${input.insightUrl}) after a person approved it. Every quote above was checked against the transcript it came from.`;
}
