/**
 * Payments (ADR 0025), without Stripe: checkout names the company and plan on
 * the session and on the subscription it makes, reuses the company's Stripe
 * customer when there is one, and billing opens on that customer. Off without
 * a key that is Stripe's.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBillingPortal, createCheckout, formBody, stripeAvailable } from '../lib/stripe';

beforeEach(() => vi.stubEnv('STRIPE_SECRET_KEY', 'rk_test_abc'));
afterEach(() => vi.unstubAllEnvs());

function fakeStripe(status = 200, body: unknown = { url: 'https://checkout.stripe.com/c/pay/cs_test_1' }) {
  const doFetch = vi.fn(async () => new Response(JSON.stringify(body), { status }));
  const sent = () => {
    const [url, init] = doFetch.mock.calls[0] as unknown as [string, RequestInit];
    return { url, fields: Object.fromEntries(new URLSearchParams(String(init.body))), auth: (init.headers as Record<string, string>)['authorization'] };
  };
  return { doFetch: doFetch as unknown as typeof fetch, sent };
}

const checkout = {
  companyId: '00000000-0000-4000-8000-00000000000a',
  plan: 'basic',
  priceId: 'price_Basic1',
  quantity: 3,
  customerId: null,
  email: 'owner@acme.test',
  successUrl: 'https://app.test/settings?billing=started',
  cancelUrl: 'https://app.test/settings',
};

describe('createCheckout', () => {
  it('names the company and plan on the session and on the subscription it makes', async () => {
    const { doFetch, sent } = fakeStripe();
    expect(await createCheckout(checkout, doFetch)).toEqual({ url: 'https://checkout.stripe.com/c/pay/cs_test_1' });
    const { url, fields, auth } = sent();
    expect(url).toBe('https://api.stripe.com/v1/checkout/sessions');
    expect(auth).toBe('Bearer rk_test_abc');
    expect(fields).toEqual({
      mode: 'subscription',
      'line_items[0][price]': 'price_Basic1',
      'line_items[0][quantity]': '3',
      client_reference_id: checkout.companyId,
      'metadata[company_id]': checkout.companyId,
      'metadata[plan]': 'basic',
      'subscription_data[metadata][company_id]': checkout.companyId,
      'subscription_data[metadata][plan]': 'basic',
      customer_email: 'owner@acme.test',
      success_url: checkout.successUrl,
      cancel_url: checkout.cancelUrl,
    });
  });

  it('reuses the company’s Stripe customer rather than making another', async () => {
    const { doFetch, sent } = fakeStripe();
    await createCheckout({ ...checkout, customerId: 'cus_A' }, doFetch);
    expect(sent().fields['customer']).toBe('cus_A');
    expect(sent().fields['customer_email']).toBeUndefined();
  });

  it('says what Stripe refused', async () => {
    const { doFetch } = fakeStripe(400, { error: { type: 'invalid_request_error', message: 'No such price' } });
    await expect(createCheckout(checkout, doFetch)).rejects.toThrow('Stripe refused: 400 invalid_request_error No such price');
  });
});

describe('billing and switches', () => {
  it('opens billing on the customer, coming back to Settings', async () => {
    const { doFetch, sent } = fakeStripe(200, { url: 'https://billing.stripe.com/p/session/x' });
    expect(await createBillingPortal('cus_A', 'https://app.test/settings', doFetch)).toEqual({ url: 'https://billing.stripe.com/p/session/x' });
    expect(sent()).toMatchObject({ url: 'https://api.stripe.com/v1/billing_portal/sessions', fields: { customer: 'cus_A', return_url: 'https://app.test/settings' } });
  });

  it('is off without a key that is Stripe’s, and leaves out what is not given', () => {
    expect(stripeAvailable()).toBe(true);
    vi.stubEnv('STRIPE_SECRET_KEY', 'pk_test_publishable');
    expect(stripeAvailable()).toBe(false);
    expect(formBody({ a: '1', b: null, c: undefined, 'd[e]': 'x y' })).toBe('a=1&d%5Be%5D=x+y');
  });
});
