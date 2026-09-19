import { describe, expect, it } from 'vitest';
import { ticketBody, ticketTitle, type TicketCitation } from '../lib/ticket';

const CITATIONS: TicketCitation[] = [
  {
    quote: 'takes us most of Friday afternoon',
    conversationTitle: 'Acme Robotics — discovery call',
    conversationId: 'c1',
    segmentId: 's1',
    startMs: 61_000,
    speaker: 'Priya Raman',
  },
  {
    quote: 're-keys about four hundred invoices a month',
    conversationTitle: 'Quarry Materials — annual review',
    conversationId: 'c2',
    segmentId: 's9',
    startMs: 8000,
    speaker: null,
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

  it('names the customer and the time for every quote', () => {
    // The gate's requirement, and the thing that makes a ticket checkable by
    // someone who has never opened this product.
    const body = ticketBody(INPUT);

    expect(body).toContain('Priya Raman, Acme Robotics — discovery call at 01:01');
    expect(body).toContain('Quarry Materials — annual review at 00:08');
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

  it('omits the speaker when nobody was attributed', () => {
    const body = ticketBody({ ...INPUT, citations: [CITATIONS[1]!] });

    expect(body).toContain('— Quarry Materials');
    expect(body).not.toContain('— null');
  });
});

describe('ticketTitle', () => {
  it('is the insight title, trimmed', () => {
    expect(ticketTitle({ ...INPUT, title: '  Spaced out  ' })).toBe('Spaced out');
  });
});
