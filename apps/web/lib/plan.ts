import type { SupabaseClient } from '@tesserafy/db';
import { NextResponse } from 'next/server';

/**
 * Spending a company's monthly AI allowance.
 *
 * Distinct from lib/rate-limit.ts, and on top of it. The rate limit is a
 * per-account ceiling per hour and per day that stops a runaway loop or a
 * stolen session; it knows nothing about plans. This is what a plan includes
 * in a month — Basic's ten imported calls, Pro's twenty-five — and it is
 * charged against the company, whoever in it spends it.
 *
 * `take_plan_allowance` checks and charges in one locked statement, so two
 * requests cannot both spend the last call. When the AI work it paid for then
 * fails, the route gives it back: a failed extraction should not cost the
 * customer part of their month.
 *
 * Closed on failure, like the rate limiter: if the allowance cannot be read,
 * the model is not called. A limiter that fails open is not a limiter.
 */

export type Meter = 'calls' | 'extractions' | 'pattern_runs' | 'live_seconds';

export type Spent =
  | { allowed: true; ledgerId: number }
  | {
      allowed: false;
      meter: Meter;
      used: number;
      limit: number | null;
      plan: string;
      resetsAt: string | null;
      error?: string;
    };

interface TakeResult {
  allowed: boolean;
  ledger_id?: number;
  used: number;
  limit: number | null;
  plan: string;
  resets_at: string | null;
}

export async function spend(db: SupabaseClient, meter: Meter, amount = 1): Promise<Spent> {
  const { data, error } = await db.rpc('take_plan_allowance', { p_meter: meter, p_amount: amount });
  if (error || !data) {
    return { allowed: false, meter, used: 0, limit: 0, plan: 'none', resetsAt: null, error: error?.message ?? 'no answer' };
  }
  const result = data as unknown as TakeResult;
  if (result.allowed && result.ledger_id !== undefined) return { allowed: true, ledgerId: result.ledger_id };
  return {
    allowed: false,
    meter,
    used: result.used,
    limit: result.limit,
    plan: result.plan,
    resetsAt: result.resets_at,
  };
}

/** Gives back an allowance whose work failed. Never throws: a refund is a courtesy, not a gate. */
export async function refund(db: SupabaseClient, spent: Spent): Promise<void> {
  if (!spent.allowed) return;
  await db.rpc('refund_plan_allowance', { p_ledger_id: spent.ledgerId });
}

const NOUN: Record<Meter, [string, string]> = {
  calls: ['imported call', 'imported calls'],
  extractions: ['“Find insights in this call”', '“Find insights in this call” runs'],
  pattern_runs: ['“Look for patterns” run', '“Look for patterns” runs'],
  live_seconds: ['live minute', 'live minutes'],
};

const PLAN_NAME: Record<string, string> = { trial: 'trial', basic: 'Basic plan', pro: 'Pro plan' };

function day(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', timeZone: 'UTC' });
}

/** What to tell the person, in the product's words, not the meter's. */
export function describeRefusal(spent: Extract<Spent, { allowed: false }>): string {
  if (spent.error) return 'Your plan could not be checked just now, so nothing was run. Try again shortly.';
  if (spent.plan === 'none') {
    return 'Your company has no plan at the moment. An owner can choose one under Settings → Plan.';
  }
  const limit = spent.meter === 'live_seconds' ? Math.round((spent.limit ?? 0) / 60) : (spent.limit ?? 0);
  const [one, many] = NOUN[spent.meter];
  const what = `${limit} ${limit === 1 ? one : many}`;
  const plan = PLAN_NAME[spent.plan] ?? `${spent.plan} plan`;
  const next =
    spent.plan === 'pro'
      ? `It resets on ${day(spent.resetsAt)}.`
      : spent.plan === 'trial'
        ? 'An owner can choose Basic or Pro under Settings → Plan.'
        : `An owner can upgrade under Settings → Plan, or it resets on ${day(spent.resetsAt)}.`;
  // The trial is fourteen days, not a month.
  const per = spent.plan === 'trial' ? '' : ' a month';
  return `Your ${plan} includes ${what}${per}, and they have all been used. ${next}`;
}

/** 402: the request was fine; the plan has none of this left. */
export function planExhausted(spent: Extract<Spent, { allowed: false }>): NextResponse {
  return NextResponse.json(
    {
      error: describeRefusal(spent),
      meter: spent.meter,
      used: spent.used,
      limit: spent.limit,
      resetsAt: spent.resetsAt,
    },
    { status: spent.error ? 503 : 402 },
  );
}

/**
 * Seconds of live time one detection spends: the utterance it was asked
 * about, from its own timestamps, held between 5 and 30 seconds.
 *
 * The timestamps come from the caller, so they are bounded both ways: a
 * floor so a client cannot report every utterance as instant and never be
 * charged, and a ceiling so one bad clock does not empty an allowance.
 * Sixty live minutes is then at most 720 detections.
 */
export function liveSeconds(window: readonly { startMs: number; endMs: number }[]): number {
  const last = window.at(-1);
  const seconds = last ? Math.round((last.endMs - last.startMs) / 1000) : 0;
  return Math.min(30, Math.max(5, Number.isFinite(seconds) ? seconds : 5));
}
