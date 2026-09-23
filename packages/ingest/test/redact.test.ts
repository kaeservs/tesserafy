/**
 * Redaction, and the two ways it can be wrong.
 *
 * Leaving an identifier in is visible: somebody reads the transcript and sees
 * it. Taking a finding out is not — a quantified pain that got masked is a
 * signal nobody ever knows was there. So the tests that matter most here are
 * the ones asserting that ordinary speech survives.
 */
import { describe, expect, it } from 'vitest';
import { anyRedactions, redact } from '../src/redact/redact';

describe('what redaction removes', () => {
  it('removes an email address', () => {
    const { text, counts } = redact('Send it to priya.shah@northwind.co.uk and I will look.');

    expect(text).toBe('Send it to [email] and I will look.');
    expect(counts.emails).toBe(1);
  });

  it('removes a phone number however it is written', () => {
    for (const spoken of ['020 7946 0958', '+44 20 7946 0958', '(020) 7946-0958']) {
      const { text } = redact(`Call me on ${spoken} tomorrow.`);
      expect(text).toBe('Call me on [phone] tomorrow.');
    }
  });

  it('removes a card-length run of digits', () => {
    const { text } = redact('The card was 4111 1111 1111 1111 if that helps.');

    expect(text).not.toContain('4111');
    expect(text).toMatch(/\[(number|phone)\]/);
  });

  it('removes more than one thing in a sentence', () => {
    const { counts } = redact('Email ops@acme.com or ring 020 7946 0958.');

    expect(counts.emails).toBe(1);
    expect(counts.phones).toBe(1);
  });
});

describe('what redaction must not remove', () => {
  it('keeps a quantified pain', () => {
    // The sentence this product exists to find. Masking it would delete the
    // finding and nobody would ever know it had been there.
    const said = 'It takes about 90 minutes every morning, so roughly 450 minutes a week.';

    expect(redact(said).text).toBe(said);
  });

  it('keeps money, however it is punctuated', () => {
    for (const said of [
      'We spend about £45000 a year on that.',
      'The contract is 1,250,000 a year.',
      'It costs us $120000 in rework.',
    ]) {
      expect(redact(said).text).toBe(said);
    }
  });

  it('keeps a year, a count and a percentage', () => {
    const said = 'Since 2024 we have had 400 tickets, about 20% of the total.';

    expect(redact(said).text).toBe(said);
  });

  it('keeps a company or product name', () => {
    // Names are not removed and must not be: "Northwind's export is slow" is
    // the finding, not an identifier.
    const said = 'Northwind moved to Salesforce last year and Priya runs it.';

    expect(redact(said).text).toBe(said);
    expect(anyRedactions(redact(said).counts)).toBe(false);
  });

  it('leaves ordinary speech exactly alone', () => {
    const said = 'Exporting the weekly report takes us most of Friday afternoon.';

    expect(redact(said).text).toBe(said);
    expect(anyRedactions(redact(said).counts)).toBe(false);
  });
});

describe('reporting', () => {
  it('says nothing was removed when nothing was', () => {
    expect(anyRedactions(redact('Nothing to see.').counts)).toBe(false);
  });

  it('counts what it took, so an import can say so', () => {
    const { counts } = redact('a@b.com, c@d.com, and 020 7946 0958');

    expect(counts.emails).toBe(2);
    expect(counts.phones).toBe(1);
  });
});
