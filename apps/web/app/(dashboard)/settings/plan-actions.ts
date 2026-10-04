'use server';

import { recordFailure } from '@tesserafy/ai';
import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { createBillingPortal, createCheckout, stripeAvailable } from '@/lib/stripe';
import { createClient } from '@/lib/supabase/server';

export type PlanActionState =
  | { status: 'idle' }
  | { status: 'done'; message: string }
  | { status: 'error'; message: string };

function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === 'string' ? value : '';
}

const OUTCOME: Record<string, string> = {
  started: 'Your plan has started.',
  upgraded: 'Upgraded. The larger allowance applies now.',
  downgrade_scheduled: 'The change will happen at the end of this period. Until then you keep what you have.',
  kept: 'Done — nothing will change at the end of this period.',
};

/**
 * Start, upgrade, downgrade, or undo a pending change — whichever the choice
 * means from where the company is. `change_plan` decides which; the owner
 * only says which plan they want.
 *
 * Free until payments exist (the owner's decision): starting or upgrading
 * takes effect without checkout. When Stripe lands, those two become a
 * redirect to checkout, and the database's rules do not change.
 */
async function changePlan(formData: FormData): Promise<PlanActionState> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('change_plan', { p_plan: text(formData, 'plan') });
  if (error) {
    return {
      status: 'error',
      message:
        error.code === '42501'
          ? 'Only an owner can change the plan.'
          : error.message.replace(/^change_plan: /, ''),
    };
  }
  revalidatePath('/settings');
  return { status: 'done', message: OUTCOME[data] ?? 'Done.' };
}

async function cancelPlan(): Promise<PlanActionState> {
  const supabase = await createClient();
  const { error } = await supabase.rpc('cancel_plan');
  if (error) {
    return {
      status: 'error',
      message:
        error.code === '42501' ? 'Only an owner can cancel.' : error.message.replace(/^cancel_plan: /, ''),
    };
  }
  revalidatePath('/settings');
  return {
    status: 'done',
    message: 'Cancelled. The plan runs to the end of this period; your calls stay after that.',
  };
}

/** Where Stripe sends the owner back to: this deployment, as the owner reached it. */
async function settingsUrl(query = ''): Promise<string> {
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000';
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') || host.startsWith('127.') ? 'http' : 'https');
  return `${proto}://${host}/settings${query}`;
}

/**
 * Checkout for a paid plan (ADR 0025): `billing_checkout` decides whether the
 * caller may and which price it is; Stripe's page takes the payment; Stripe's
 * webhook, checked by the database, starts the plan.
 */
async function checkout(formData: FormData): Promise<PlanActionState> {
  if (!stripeAvailable()) return { status: 'error', message: 'Payments are not switched on for this deployment yet.' };
  const supabase = await createClient();
  const plan = text(formData, 'plan');
  const { data, error } = await supabase.rpc('billing_checkout', { p_plan: plan });
  if (error) {
    return {
      status: 'error',
      message:
        error.code === '42501'
          ? 'Only an owner can choose what the company pays for.'
          : error.message.replace(/^billing_checkout: /, ''),
    };
  }
  const target = data as { company_id: string; price_id: string; customer_id: string | null; email: string | null };
  let url: string;
  try {
    ({ url } = await createCheckout({
      companyId: target.company_id,
      plan,
      priceId: target.price_id,
      customerId: target.customer_id,
      email: target.email,
      successUrl: await settingsUrl('?billing=started'),
      cancelUrl: await settingsUrl(),
    }));
  } catch (failed) {
    const failure = recordFailure(failed, { db: supabase, source: 'settings/checkout' });
    return { status: 'error', message: failure.said };
  }
  redirect(url);
}

/** Stripe's billing page, for a company paying through Stripe. */
async function billing(): Promise<PlanActionState> {
  if (!stripeAvailable()) return { status: 'error', message: 'Payments are not switched on for this deployment yet.' };
  const supabase = await createClient();
  const { data: customer, error } = await supabase.rpc('billing_customer');
  if (error || !customer) {
    return {
      status: 'error',
      message: error?.code === '42501' ? 'Only an owner can open billing.' : 'The company has not paid through Stripe.',
    };
  }
  let url: string;
  try {
    ({ url } = await createBillingPortal(customer, await settingsUrl()));
  } catch (failed) {
    const failure = recordFailure(failed, { db: supabase, source: 'settings/billing' });
    return { status: 'error', message: failure.said };
  }
  redirect(url);
}

/**
 * Every plan button goes through here, so the message the page shows is
 * always the answer to the last thing the owner did. With one action per
 * kind of change, a cancel's page kept showing an earlier "nothing will
 * change" — the opposite of what had just happened.
 */
export async function planAction(_prev: PlanActionState, formData: FormData): Promise<PlanActionState> {
  const intent = text(formData, 'intent');
  if (intent === 'checkout') return checkout(formData);
  if (intent === 'billing') return billing();
  return intent === 'cancel' ? cancelPlan() : changePlan(formData);
}
