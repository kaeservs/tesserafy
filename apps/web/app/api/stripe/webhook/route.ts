import { createClient } from '@supabase/supabase-js';
import type { Database } from '@tesserafy/db';
import { NextResponse, type NextRequest } from 'next/server';
import { publicSupabaseEnv } from '@/lib/env';

/**
 * POST /api/stripe/webhook — Stripe's events, forwarded to the database as
 * they arrived (ADR 0025).
 *
 * Nothing here decides whether an event is real: the body and the
 * Stripe-Signature header go to `stripe_event` byte for byte, as nobody, and
 * the database checks the signature with a secret only it and Stripe hold.
 * The body is read as text and never parsed or re-serialised here, because
 * the signature is over the exact bytes Stripe sent.
 *
 * Stripe retries anything that is not a 2xx, so a refused signature is a 400
 * (retrying will not fix it) and anything else a 500 (it might).
 */
export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const payload = await request.text();
  const signature = request.headers.get('stripe-signature') ?? '';
  const { url, publishableKey } = publicSupabaseEnv();
  const db = createClient<Database>(url, publishableKey, { auth: { persistSession: false, autoRefreshToken: false } });

  const { data, error } = await db.rpc('stripe_event', { p_payload: payload, p_signature: signature });
  if (error) {
    if (error.code === '28000') return NextResponse.json({ error: 'not a Stripe event' }, { status: 400 });
    if (error.code === '55000') return NextResponse.json({ error: 'payments are not set up' }, { status: 503 });
    // Seen by Stripe, which retries and shows it on the webhook's page; there
    // is no signed-in caller here to record a failure as.
    console.error(`stripe webhook: ${error.code ?? ''} ${error.message}`);
    return NextResponse.json({ error: 'not processed' }, { status: 500 });
  }
  return NextResponse.json({ received: data });
}
