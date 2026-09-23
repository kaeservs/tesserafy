/**
 * Removing identifiers before anything stores them. Tier T0, ADR 0002.
 *
 * A transcript of a real call carries things the product never needs and
 * cannot responsibly hold: an email address read out loud, a direct line, a
 * card number given to a support agent. Until now nothing removed them, so
 * the first real transcript would have put all of it into segments,
 * embeddings, model prompts, GitHub ticket bodies and the search index.
 *
 * ---------------------------------------------------------------------------
 * Why this happens before storage, not at each egress
 * ---------------------------------------------------------------------------
 * "Every quote is verbatim" and "we removed the customer's email" cannot both
 * be literally true. Which one survives is decided by where the masking
 * happens.
 *
 * Masking at each egress would keep the database truthful, and would break
 * the evidence chain: a detector locates its quote in the text it was sent,
 * so sending masked text while storing raw text means the offsets it returns
 * point at the wrong characters. Length-preserving masks would paper over
 * that, in two places, forever.
 *
 * Masking here means the identifier is never stored at all, and every
 * downstream claim stays exactly as strong as it was: a quote is verbatim
 * with respect to the transcript as recorded. There are four egresses today
 * and this fixes them at once, including the ones nobody thinks of — backups,
 * and the search index.
 *
 * The cost, stated rather than buried: it cannot be undone, and the stored
 * transcript is no longer literally what was said.
 *
 * ---------------------------------------------------------------------------
 * What this does not do
 * ---------------------------------------------------------------------------
 * It does not remove names. A regular expression cannot tell a person from a
 * product from a company, and one that tried would quietly destroy the
 * evidence — "Northwind's export is slow" is the finding, not an identifier.
 * Speaker labels are left alone for the same reason: the product's whole
 * claim rests on knowing who said a thing.
 *
 * So this is not anonymisation and must not be described as it. It removes
 * the identifiers a pattern can recognise with confidence, which is the
 * subset that would otherwise end up in a third party's systems.
 */

/** What was found, so a caller can say how much was removed. */
export interface RedactionCount {
  readonly emails: number;
  readonly phones: number;
  readonly numbers: number;
}

export interface Redacted {
  readonly text: string;
  readonly counts: RedactionCount;
}

/**
 * Deliberately conservative. A pattern that also matches ordinary speech
 * removes evidence, and evidence removed is a finding nobody ever sees — a
 * worse failure here than an identifier that survives, because the second one
 * is visible to whoever reads the transcript and the first one is not.
 */
const EMAIL = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;

/**
 * One pass over anything digit-shaped, classified afterwards by what it looks
 * like.
 *
 * Two patterns in sequence was a bug: the longer one matched first and ate
 * "+44 20 7946 0958" from the digits inward, leaving a bare "+" behind. One
 * pattern cannot get out of step with itself.
 *
 * Seven digits is the floor. Six would take years and quantities with it, and
 * "about 250000 invoices" is exactly the sentence this product exists to
 * find.
 */
const DIGITS = /(?:\+\d{1,3}[\s.-]?)?(?:\(\d{1,4}\)[\s.-]?)?\d(?:[\s.-]?\d){6,}/g;

/** Fifteen digits or more is an account or a card, not a number to ring. */
const ACCOUNT_LENGTH = 15;

function looksLikeMoney(match: string, text: string, index: number): boolean {
  // "1,250,000" and "£45000" are the figures a quantified pain is made of.
  const before = text.slice(Math.max(0, index - 1), index);
  return /[£$€]/.test(before) || match.includes(',');
}

/**
 * Masks the identifiers in one piece of text.
 *
 * Labels rather than blocks, so a reader of a quote can see what was taken
 * out. A row of asterisks reads as damage; `[email]` reads as a decision.
 */
export function redact(text: string): Redacted {
  let emails = 0;
  let phones = 0;
  let numbers = 0;

  let out = text.replace(EMAIL, () => {
    emails += 1;
    return '[email]';
  });

  out = out.replace(DIGITS, (match: string, index: number) => {
    if (looksLikeMoney(match, out, index)) return match;

    const digits = match.replace(/\D/g, '').length;
    if (digits >= ACCOUNT_LENGTH) {
      numbers += 1;
      return '[number]';
    }
    phones += 1;
    return '[phone]';
  });

  return { text: out, counts: { emails, phones, numbers } };
}

/** Totals across many pieces of text, for reporting what an import removed. */
export function addCounts(a: RedactionCount, b: RedactionCount): RedactionCount {
  return {
    emails: a.emails + b.emails,
    phones: a.phones + b.phones,
    numbers: a.numbers + b.numbers,
  };
}

export const NO_REDACTIONS: RedactionCount = { emails: 0, phones: 0, numbers: 0 };

/** Did anything get removed? */
export function anyRedactions(counts: RedactionCount): boolean {
  return counts.emails + counts.phones + counts.numbers > 0;
}

/**
 * Redacts a whole transcript, reporting what it took.
 *
 * Applied to segments rather than to the raw file, so it runs after chunking
 * and sees the same text a quote will later point at. Running it earlier
 * would risk the parser and the redactor disagreeing about where a segment
 * begins.
 */
export function redactSegments<T extends { readonly text: string }>(
  segments: readonly T[],
): { segments: T[]; counts: RedactionCount } {
  let counts = NO_REDACTIONS;

  const cleaned = segments.map((segment) => {
    const { text, counts: found } = redact(segment.text);
    counts = addCounts(counts, found);
    return text === segment.text ? segment : { ...segment, text };
  });

  return { segments: cleaned, counts };
}
