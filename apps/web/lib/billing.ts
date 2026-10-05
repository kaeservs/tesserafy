import type { SupabaseClient } from '@tesserafy/db';
import { stripeAvailable } from './stripe';

/**
 * How a company's plan is paid for (ADR 0025), for the plan panel wherever it
 * shows: through Stripe's billing page once the company pays there; through
 * checkout once payments are on; free before that.
 */
export type BillingMode = 'free' | 'checkout' | 'stripe';

export async function billingMode(db: SupabaseClient, companyId: string): Promise<BillingMode> {
  const [{ data: ready }, { data: subscription }] = await Promise.all([
    db.rpc('payments_ready'),
    db.from('subscriptions').select('provider').eq('company_id', companyId).maybeSingle(),
  ]);
  if (subscription?.provider === 'stripe') return 'stripe';
  return ready === true && stripeAvailable() ? 'checkout' : 'free';
}
