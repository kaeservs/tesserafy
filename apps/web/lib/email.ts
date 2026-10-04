/**
 * Sending a call's follow-up email (ADR 0023), through Resend.
 *
 * From Tesserafy's own sending address with the seller's name on it, never
 * from the seller's address: a message claiming a domain it was not sent from
 * is a forgery, however well meant, and mail systems treat it as one. Replies
 * go to the seller and the seller is copied, so the conversation carries on
 * in their own mailbox.
 *
 * Plain text only: the email is the seller's words and the call's, and HTML
 * built from them is a way to send something other than what was shown.
 */

const RESEND_EMAILS = 'https://api.resend.com/emails';

/** The bare address everything is sent from: `EMAIL_FROM`, on a domain verified with Resend. */
export function sendingAddress(): string | null {
  const address = process.env['EMAIL_FROM']?.trim() ?? '';
  return isAddress(address) ? address : null;
}

export function emailAvailable(): boolean {
  return Boolean(process.env['RESEND_API_KEY']?.trim()) && sendingAddress() !== null;
}

export function isAddress(value: string): boolean {
  return value.length <= 320 && /^[^@\s<>",;]+@[^@\s<>",;]+\.[^@\s<>",;]+$/.test(value);
}

/** One to ten addresses, as typed: commas, semicolons, spaces or new lines between them. Null if any is not one. */
export function parseRecipients(input: unknown): string[] | null {
  const parts = Array.isArray(input) ? input : typeof input === 'string' ? input.split(/[\s,;]+/) : null;
  if (!parts) return null;
  const addresses = [...new Set(parts.filter((part): part is string => typeof part === 'string').map((part) => part.trim().toLowerCase()).filter(Boolean))];
  if (addresses.length === 0 || addresses.length > 10 || !addresses.every(isAddress)) return null;
  return addresses;
}

/** A name to show as the sender: no line breaks, and nothing that would make it an address. */
export function isSenderName(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length >= 1 && value.trim().length <= 100 && !/[\r\n<>"]/.test(value);
}

export function isSubject(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length >= 1 && value.trim().length <= 200 && !/[\r\n]/.test(value);
}

export function isBody(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length >= 1 && value.length <= 20_000;
}

export interface OutgoingEmail {
  readonly fromName: string;
  readonly to: readonly string[];
  readonly replyTo: string;
  readonly subject: string;
  readonly text: string;
}

/**
 * Hands the email to Resend. `key` is the send's record id: Resend sends a
 * key once, so a request retried after a timeout cannot send it twice.
 */
export async function sendEmail(email: OutgoingEmail, key: string, doFetch: typeof fetch = fetch): Promise<{ id: string }> {
  const apiKey = process.env['RESEND_API_KEY']?.trim();
  const from = sendingAddress();
  if (!apiKey || !from) throw new Error('email is not switched on for this deployment');
  const response = await doFetch(RESEND_EMAILS, {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json', 'idempotency-key': key },
    body: JSON.stringify({
      from: `"${email.fromName.trim()}" <${from}>`,
      to: email.to,
      // The seller sees exactly what went out, in their own mailbox.
      cc: email.to.includes(email.replyTo.toLowerCase()) ? [] : [email.replyTo],
      reply_to: email.replyTo,
      subject: email.subject.trim(),
      text: email.text,
    }),
  });
  const body = (await response.json().catch(() => ({}))) as { id?: string; message?: string; name?: string };
  if (!response.ok || !body.id) {
    throw new Error(`Resend refused the email: ${response.status} ${body.name ?? ''} ${body.message ?? ''}`.trim());
  }
  return { id: body.id };
}
