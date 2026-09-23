import { describe, expect, it } from 'vitest';
import { ticketBody, ticketTitle, type TicketCitation } from '../lib/ticket';

const CITATIONS: TicketCitation[] = [
  {
    quote: 'takes us most of Friday afternoon',
    conversationId: 'c1',
    segmentId: 's1',
    startMs: 61_000,
  },
  {
    quote: 're-keys about four hundred invoices a month',
    conversationId: 'c2',
    segmentId: 's9',
    startMs: 8000,
  },
];

const INPUT = {
  title: 'Hand-stitching data across systems eats hours every cycle',
  summary: 'Customers describe the same routine across reporting, quality and dispatch.',
  citations: CITATIONS,
  insightUrl: 'https://app.example.com/insights/i1',
};

describe('ticketBody', () => {
  it('quotes the evidence verbatim', () => {
    const body = ticketBody(INPUT);

    for (const citation of CITATIONS) {
      expect(body).toContain(citation.quote);
    }
  });

  it('places every quote in a numbered call at a time', () => {
    // What replaced the speaker and the title: enough to tell two calls apart
    // and to find the moment, and no more than that.
    const body = ticketBody(INPUT);

    expect(body).toContain('call 1 at 01:01');
    expect(body).toContain('call 2 at 00:08');
  });

  it('gives the same call the same number wherever it appears', () => {
    const interleaved = [CITATIONS[0]!, CITATIONS[1]!, { ...CITATIONS[0]!, segmentId: 's4' }];
    const body = ticketBody({ ...INPUT, citations: interleaved });

    expect(body.match(/call 1 at/g)).toHaveLength(2);
    expect(body).not.toContain('call 3');
  });

  it('links each quote back to its place in the transcript', () => {
    const body = ticketBody(INPUT);

    expect(body).toContain('https://app.example.com/conversations/c1#segment-s1');
    expect(body).toContain('https://app.example.com/conversations/c2#segment-s9');
  });

  it('says how much evidence there is, and from how many conversations', () => {
    expect(ticketBody(INPUT)).toContain('2 quotes from 2 conversations');
  });

  it('counts two quotes from one conversation as one conversation', () => {
    const sameCall = [CITATIONS[0]!, { ...CITATIONS[1]!, conversationId: 'c1' }];

    expect(ticketBody({ ...INPUT, citations: sameCall })).toContain('2 quotes from 1 conversation');
  });

  it('reads correctly with a single citation', () => {
    expect(ticketBody({ ...INPUT, citations: [CITATIONS[0]!] })).toContain(
      '1 quote from 1 conversation',
    );
  });

  it('says a person approved it, and links back to the insight', () => {
    const body = ticketBody(INPUT);

    expect(body).toContain('after a person approved it');
    expect(body).toContain('https://app.example.com/insights/i1');
  });
});

describe('what a ticket must never carry', () => {
  // A tracker is outside this product: it cannot be erased from, it is usually
  // readable by a whole engineering organisation, and sometimes by anyone. The
  // type is the real guarantee — there is no field here to leak — so these
  // assert the property the type is there to protect, in the terms a reader
  // cares about.
  it('has no field for a speaker or a conversation title', () => {
    const citation: TicketCitation = CITATIONS[0]!;

    expect(Object.keys(citation).sort()).toEqual([
      'conversationId',
      'quote',
      'segmentId',
      'startMs',
    ]);
  });

  it('says where the identifying detail went, so nobody adds it back', () => {
    expect(ticketBody(INPUT)).toContain('deliberately not in this ticket');
  });
});

describe('ticketTitle', () => {
  it('is the insight title, trimmed', () => {
    expect(ticketTitle({ ...INPUT, title: '  Spaced out  ' })).toBe('Spaced out');
  });
});
