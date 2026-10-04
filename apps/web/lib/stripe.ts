/**
 * Stripe, for the two pages it hosts (ADR 0025): checkout, where an owner
 * starts paying for a plan, and billing, where a paying company changes plan,
 * card or invoices, or cancels. Both are a session made here with the secret
 * key and a URL the owner is sent to.
 *
 * What Stripe says back does not come through here: its webhook is forwarded
 * to the database, which checks the signature itself (`stripe_event`).
 *
 * The key belongs in this server's environment only, and a restricted key
 * with write access to Checkout Sessions and Customer portal is all it needs.
 */

const API = 'https://api.stripe.com/v1';

export function stripeAvailable(): boolean {
  return /^(sk|rk)_(live|test)_/.test(process.env['STRIPE_SECRET_KEY']?.trim() ?? '');
}

/** Stripe takes form encoding, with nested keys in brackets. */
export function formBody(fields: Record<string, string | null | undefined>): string {
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(fields)) if (value !== null && value !== undefined) body.append(key, value);
  return body.toString();
}

async function post(path: string, fields: Record<string, string | null | undefined>, doFetch: typeof fetch): Promise<{ url: string }> {
  const key = process.env['STRIPE_SECRET_KEY']?.trim();
  if (!key || !stripeAvailable()) throw new Error('payments are not switched on for this deployment');
  const response = await doFetch(`${API}${path}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/x-www-form-urlencoded' },
    body: formBody(fields),
  });
  const body = (await response.json().catch(() => ({}))) as { url?: string; error?: { type?: string; message?: string } };
  if (!response.ok || !body.url) {
    throw new Error(`Stripe refused: ${response.status} ${body.error?.type ?? ''} ${body.error?.message ?? ''}`.trim());
  }
  return { url: body.url };
}

export interface Checkout {
  readonly companyId: string;
  readonly plan: string;
  readonly priceId: string;
  /** The company's Stripe customer from before, so a second subscription is not a second customer. */
  readonly customerId: string | null;
  readonly email: string | null;
  readonly successUrl: string;
  readonly cancelUrl: string;
}

/**
 * A subscription checkout for one plan. The company and plan go in twice: on
 * the session (`client_reference_id`, metadata) for `checkout.session.completed`,
 * and on the subscription it makes, so its own events find the company even
 * if they arrive first.
 */
export function createCheckout(checkout: Checkout, doFetch: typeof fetch = fetch): Promise<{ url: string }> {
  return post(
    '/checkout/sessions',
    {
      mode: 'subscription',
      'line_items[0][price]': checkout.priceId,
      'line_items[0][quantity]': '1',
      client_reference_id: checkout.companyId,
      'metadata[company_id]': checkout.companyId,
      'metadata[plan]': checkout.plan,
      'subscription_data[metadata][company_id]': checkout.companyId,
      'subscription_data[metadata][plan]': checkout.plan,
      customer: checkout.customerId,
      customer_email: checkout.customerId ? null : checkout.email,
      success_url: checkout.successUrl,
      cancel_url: checkout.cancelUrl,
    },
    doFetch,
  );
}

/** Stripe's billing page for a paying company: plan, card, invoices, cancelling. */
export function createBillingPortal(customerId: string, returnUrl: string, doFetch: typeof fetch = fetch): Promise<{ url: string }> {
  return post('/billing_portal/sessions', { customer: customerId, return_url: returnUrl }, doFetch);
}
