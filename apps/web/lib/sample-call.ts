import type { Turn } from '@tesserafy/ingest';

/**
 * The sample call a new company can import in one click, to see a scorecard,
 * its quotes and Who talked before they have a transcript of their own.
 *
 * Invented: the people, the companies and the figures. A discovery call that
 * establishes most of what the Discovery scorecard asks — how things are done
 * today, what it costs, what they want and by when — and deliberately never
 * reaches budget, so the first scorecard anyone sees shows a gap as well as
 * what was met, which is the point of the product.
 *
 * Changing the words changes what every future sample shows; samples already
 * imported keep the words they were imported with.
 */

export const SAMPLE_TITLE = 'Sample call: Harbor & Pine Logistics, discovery';

const LINES: readonly (readonly [speaker: string, seconds: number, text: string])[] = [
  ['Maya Chen', 2, 'Thanks for making the time, Tom. Before I show you anything, could you walk me through how weekly reporting works for you today?'],
  ['Tom Okafor', 11, 'Sure. Every Friday two of my analysts pull shipment data out of our warehouse system and the carrier portals, paste it into one big spreadsheet, and build the weekly report for the ops leads.'],
  ['Maya Chen', 27, 'How many sources are we talking about?'],
  ['Tom Okafor', 31, 'Five. The warehouse system, three carrier portals, and the returns tracker, which is its own spreadsheet that someone updates by hand.'],
  ['Maya Chen', 44, 'And how long does that take them?'],
  ['Tom Okafor', 48, 'Most of Friday. Call it six hours each, so twelve hours a week between them, and more at month end when finance wants the numbers reconciled.'],
  ['Maya Chen', 61, 'Twelve hours a week is a lot of senior analyst time. What does it cost you beyond the hours?'],
  ['Tom Okafor', 68, 'Honestly the mistakes hurt more. Last quarter we sent a report with a carrier column shifted by one row, and we held back about forty thousand dollars of invoices that were actually fine. It took two weeks to untangle.'],
  ['Maya Chen', 86, 'That would get anyone’s attention. Who noticed?'],
  ['Tom Okafor', 90, 'The carrier did, when they stopped getting paid. Which is not how you want to find out.'],
  ['Maya Chen', 99, 'If this worked the way you wanted, what would Friday look like?'],
  ['Tom Okafor', 104, 'The report would just be there on Monday morning, the same numbers finance sees, and my analysts would spend Friday on the questions the report raises instead of building it.'],
  ['Maya Chen', 118, 'So the goal is a report that builds itself and that finance trusts, and the analysts’ time goes back to analysis.'],
  ['Tom Okafor', 125, 'Exactly. And if it could flag a carrier whose on-time rate drops, even better. Right now we only notice when a customer complains.'],
  ['Maya Chen', 138, 'Is there a date this needs to be working by?'],
  ['Tom Okafor', 142, 'We plan next year’s carrier contracts in January. I would like the new reporting running before then, so we are negotiating with numbers we believe.'],
  ['Maya Chen', 155, 'So you want it live before the January contract round?'],
  ['Tom Okafor', 159, 'Yes. Ideally by mid-December, so we have a few weeks of clean numbers before we sit down with the carriers.'],
  ['Maya Chen', 168, 'Mid-December is realistic if we start the data connections this quarter. Who else would be involved in deciding?'],
  ['Tom Okafor', 176, 'Me, our head of finance, Priya, because she owns the numbers, and IT will want to look at how you connect to the warehouse system.'],
  ['Maya Chen', 189, 'That makes sense. Would it help if I sent a short summary of what you have told me, so Priya sees the same picture?'],
  ['Tom Okafor', 196, 'Please. And send over the security documents for IT while you are at it.'],
  ['Maya Chen', 203, 'Will do. I will send both today and suggest a time next week with Priya.'],
  ['Tom Okafor', 210, 'Sounds good. Thanks, Maya.'],
];

/** The call as turns, as though it had been parsed from a transcript. */
export function sampleTurns(): Turn[] {
  return LINES.map(([speaker, seconds, text], index) => ({
    speaker,
    startMs: seconds * 1000,
    endMs: (LINES[index + 1]?.[1] ?? seconds + 6) * 1000,
    text,
  }));
}
