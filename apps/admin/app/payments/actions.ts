'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/admin';

export type PaymentsState = { status: 'idle' } | { status: 'saved'; message: string } | { status: 'error'; message: string };

function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Stripe's signing secret for the webhook (ADR 0025): kept in the database,
 * where `stripe_event` checks every event with it, and nowhere else. The
 * console sends it once and only ever sees its last four characters again.
 */
export async function saveWebhookSecret(_prev: PaymentsState, formData: FormData): Promise<PaymentsState> {
  const admin = await requireAdmin();
  const secret = text(formData, 'secret');
  const { error } = await admin.db.rpc('admin_set_stripe_webhook_secret', { p_secret: secret });
  if (error) return { status: 'error', message: error.message.replace(/^admin_set_stripe_webhook_secret: /, '') };
  revalidatePath('/payments');
  return { status: 'saved', message: 'Saved. Stripe’s events are checked with it from now on.' };
}

/** Which Stripe price a plan is sold at. */
export async function savePrice(_prev: PaymentsState, formData: FormData): Promise<PaymentsState> {
  const admin = await requireAdmin();
  const plan = text(formData, 'plan');
  const { error } = await admin.db.rpc('admin_set_plan_price', { p_plan: plan, p_price_id: text(formData, 'price') });
  if (error) return { status: 'error', message: error.message.replace(/^admin_set_plan_price: /, '') };
  revalidatePath('/payments');
  return { status: 'saved', message: `Saved the price for ${plan}.` };
}
