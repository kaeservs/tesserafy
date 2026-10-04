/**
 * The customer's sentence, heard again through the seller's microphone, is
 * not the seller's: it is dropped. What the seller says themselves is kept,
 * even when it shares a word or two with what the customer said.
 */
import { describe, expect, it } from 'vitest';
import { ECHO_WINDOW_MS, EchoCheck, words } from '../src/renderer/hearing';

describe('EchoCheck', () => {
  it('drops the customer’s sentence when the microphone hears it from the speakers', () => {
    const check = new EchoCheck();
    check.heardThem('Month-end reporting takes us two full days.', 10_000);
    expect(check.isEcho('month end reporting takes us two days', 10_400)).toBe(true);
  });

  it('keeps what the seller said, even about the same thing', () => {
    const check = new EchoCheck();
    check.heardThem('Month-end reporting takes us two full days.', 10_000);
    expect(check.isEcho('What happens to the board pack when reporting slips?', 11_000)).toBe(false);
  });

  it('only compares sentences said close together', () => {
    const check = new EchoCheck();
    check.heardThem('We need it live by December.', 10_000);
    expect(check.isEcho('We need it live by December.', 10_000 + ECHO_WINDOW_MS + 1)).toBe(false);
  });

  it('drops a line with no words at all', () => {
    expect(new EchoCheck().isEcho(' … ', 0)).toBe(true);
    expect(words('It’s £40k — a year.')).toEqual(['it', 's', '40k', 'a', 'year']);
  });
});
