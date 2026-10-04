/**
 * Sending a follow-up (ADR 0023), without Resend: what counts as an address,
 * a sender's name that cannot forge one, and the request Resend is given —
 * from our address with the seller's name, replies to the seller, the seller
 * copied, plain text, keyed so a retry cannot send twice.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emailAvailable, isSenderName, isSubject, parseRecipients, sendEmail } from '../lib/email';

beforeEach(() => {
  vi.stubEnv('RESEND_API_KEY', 're_test');
  vi.stubEnv('EMAIL_FROM', 'followups@mail.tesserafy.test');
});
afterEach(() => vi.unstubAllEnvs());

describe('parseRecipients', () => {
  it('takes addresses as they are typed, once each', () => {
    expect(parseRecipients('Dana@Northwind.com, lee@northwind.com;\ndana@northwind.com')).toEqual(['dana@northwind.com', 'lee@northwind.com']);
    expect(parseRecipients(['a@b.co'])).toEqual(['a@b.co']);
  });
  it('refuses anything that is not one to ten addresses', () => {
    expect(parseRecipients('')).toBeNull();
    expect(parseRecipients('dana at northwind')).toBeNull();
    expect(parseRecipients('"Dana" <dana@northwind.com>')).toBeNull();
    expect(parseRecipients(Array.from({ length: 11 }, (_, i) => `p${i}@x.co`))).toBeNull();
    expect(parseRecipients(42)).toBeNull();
  });
});

describe('a sender’s name and subject', () => {
  it('cannot carry another address or a header', () => {
    expect(isSenderName('Sam Seller')).toBe(true);
    expect(isSenderName('Sam <ceo@bank.com>')).toBe(false);
    expect(isSenderName('Sam"')).toBe(false);
    expect(isSenderName('Sam\r\nBcc: x@y.z')).toBe(false);
    expect(isSubject('Following up\nBcc: x@y.z')).toBe(false);
  });
});

describe('sendEmail', () => {
  it('sends from our address with the seller’s name, replies and a copy to the seller, keyed by the record', async () => {
    const doFetch = vi.fn(async () => new Response(JSON.stringify({ id: 'msg_1' }), { status: 200 }));
    const sent = await sendEmail(
      { fromName: 'Sam Seller', to: ['dana@northwind.com'], replyTo: 'sam@acme.com', subject: 'Following up', text: 'Hi Dana' },
      'send-1',
      doFetch as unknown as typeof fetch,
    );
    expect(sent).toEqual({ id: 'msg_1' });
    const [url, init] = doFetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.resend.com/emails');
    expect((init.headers as Record<string, string>)['idempotency-key']).toBe('send-1');
    expect(JSON.parse(String(init.body))).toEqual({
      from: '"Sam Seller" <followups@mail.tesserafy.test>',
      to: ['dana@northwind.com'],
      cc: ['sam@acme.com'],
      reply_to: 'sam@acme.com',
      subject: 'Following up',
      text: 'Hi Dana',
    });
  });

  it('says what Resend refused', async () => {
    const doFetch = vi.fn(async () => new Response(JSON.stringify({ name: 'validation_error', message: 'domain is not verified' }), { status: 403 }));
    await expect(
      sendEmail({ fromName: 'Sam', to: ['d@n.co'], replyTo: 's@a.co', subject: 'S', text: 'T' }, 'k', doFetch as unknown as typeof fetch),
    ).rejects.toThrow('Resend refused the email: 403 validation_error domain is not verified');
  });

  it('is off without a key or a sending address', () => {
    expect(emailAvailable()).toBe(true);
    vi.stubEnv('EMAIL_FROM', 'Tesserafy <followups@mail.tesserafy.test>');
    expect(emailAvailable()).toBe(false);
  });
});
