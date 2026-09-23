/**
 * What a ticket says, and what it deliberately does not.
 *
 * The body is built from the insight's own citation chain, not from a summary
 * of it: every quote here is one a detector verified against its segment. An
 * engineer reading the ticket in three weeks can check the claim without
 * opening this product, which is the reason quotes are here at all.
 *
 * It carries no speaker name and no conversation title. Those identified a
 * person and, through the title, a customer — in a tracker that is usually
 * readable by a whole engineering organisation and sometimes by the public,
 * and which this product does not control and cannot erase from. Redaction
 * removes what a pattern can recognise from the quotes themselves; a name is
 * exactly what a pattern cannot recognise, so it is handled here by not
 * sending it.
 *
 * Conversations are numbered instead. "Three calls said this" is the claim
 * that makes an insight worth acting on, and a count carries it without
 * naming anyone; whoever needs to know which customer follows the link and is
 * asked to sign in.
 *
 * Pure on purpose — the interesting part is the wording, and wording is worth
 * testing.
 */

export interface TicketCitation {
  readonly quote: string;
  readonly conversationId: string;
  readonly segmentId: string;
  readonly startMs: number;
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

  // Numbered in the order they first appear, so the same call keeps the same
  // number down the list and a reader can see which quotes came together.
  const numberOf = new Map<string, number>();
  for (const citation of input.citations) {
    if (!numberOf.has(citation.conversationId)) numberOf.set(citation.conversationId, numberOf.size + 1);
  }

  const evidence = input.citations
    .map((citation) => {
      const link = `${new URL(input.insightUrl).origin}/conversations/${citation.conversationId}#segment-${citation.segmentId}`;
      const where = `call ${numberOf.get(citation.conversationId)} at ${clock(citation.startMs)}`;
      return `- “${citation.quote}”\n  — ${where} ([transcript](${link}))`;
    })
    .join('\n');

  return `${input.summary.trim()}

## Evidence

${input.citations.length} quote${input.citations.length === 1 ? '' : 's'} from ${conversations.size} conversation${conversations.size === 1 ? '' : 's'}:

${evidence}

---

Raised from [an insight in Tesserafy](${input.insightUrl}) after a person approved it. Every quote above was checked against the transcript it came from. Who said it, and which customer, are deliberately not in this ticket — follow a transcript link if you need them.`;
}
