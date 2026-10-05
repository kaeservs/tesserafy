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
 * customer part of their month. Giving back needs the one-time token the
 * charge returned, which only this server ever holds — the ledger id alone is
 * readable by any member, and once refunded any successful work from a
 * browser (20261004110000_security_review).
 *
 * Closed on failure, like the rate limiter: if the allowance cannot be read,
 * the model is not called. A limiter that fails open is not a limiter.
 */

export type Meter = 'calls' | 'extractions' | 'pattern_runs' | 'questions' | 'live_seconds';

export type Spent =
  | { allowed: true; ledgerId: number; refundToken: string }
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
  refund_token?: string;
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
  if (result.allowed && result.ledger_id !== undefined && result.refund_token !== undefined) {
    return { allowed: true, ledgerId: result.ledger_id, refundToken: result.refund_token };
  }
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
  await db.rpc('refund_plan_allowance', { p_ledger_id: spent.ledgerId, p_token: spent.refundToken });
}

const NOUN: Record<Meter, [string, string]> = {
  calls: ['imported call', 'imported calls'],
  extractions: ['“Find insights” or call prep', '“Find insights” or call preps'],
  pattern_runs: ['“Look for patterns” run', '“Look for patterns” runs'],
  questions: ['question to Ask', 'questions to Ask'],
  live_seconds: ['live minute', 'live minutes'],
};

const PLAN_NAME: Record<string, string> = {
  free: 'Free plan',
  trial: 'trial',
  basic: 'Starter plan',
  pro: 'Pro plan',
  incognito: 'Incognito plan',
};

/** Where an owner changes the plan, in the words of the page (ADR 0027). */
export const PLAN_PAGE = '/profile#membership';
const WHERE = 'Profile → Your membership';

function day(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', timeZone: 'UTC' });
}

/** What to tell the person, in the product's words, not the meter's. */
export function describeRefusal(spent: Extract<Spent, { allowed: false }>): string {
  if (spent.error) return 'Your plan could not be checked just now, so nothing was run. Try again shortly.';
  if (spent.plan === 'none') {
    return `Your company has no plan at the moment. An owner can choose one on ${WHERE}.`;
  }
  const limit = spent.meter === 'live_seconds' ? Math.round((spent.limit ?? 0) / 60) : (spent.limit ?? 0);
  const [one, many] = NOUN[spent.meter];
  const plan = PLAN_NAME[spent.plan] ?? `${spent.plan} plan`;
  if (limit === 0) {
    return `${many.charAt(0).toUpperCase()}${many.slice(1)} are not on your ${plan}. An owner can choose Starter, Pro or Incognito on ${WHERE}.`;
  }
  const what = `${limit} ${limit === 1 ? one : many}`;
  const next =
    spent.plan === 'free' || spent.plan === 'trial'
      ? `An owner can choose Starter, Pro or Incognito on ${WHERE}.`
      : spent.plan === 'basic'
        ? `An owner can upgrade or add seats on ${WHERE}, or it resets on ${day(spent.resetsAt)}.`
        : `An owner can add seats on ${WHERE}, or it resets on ${day(spent.resetsAt)}.`;
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
      // Where an owner changes the plan: the overlay offers it as a button.
      upgrade: PLAN_PAGE,
    },
    { status: spent.error ? 503 : 402 },
  );
}

/**
 * Seconds of live time one detection spends.
 *
 * The call's real time (2026-10-05): from where the caller says the last
 * charge ended (`chargeFromMs`, on the call's own clock) to the end of the
 * utterance just said. Only the customer's lines are detected, so each one
 * pays for the conversation since the one before — the seller's lines in
 * between included — and live minutes are minutes of call. Before this, each
 * line paid for itself alone, and overlays sent a line's start as its end,
 * so every line cost five seconds and a real hour was charged twelve to
 * twenty minutes.
 *
 * A caller that sends no `chargeFromMs` (an older overlay) is charged the
 * utterance's own span, as it was. The times come from the caller, so they
 * are bounded both ways: a floor so instant speech is not free, and a
 * ceiling of a minute — the most take_plan_allowance takes in one charge — so a
 * silence or one bad clock does not empty an allowance.
 */
export function liveSeconds(window: readonly { startMs: number; endMs: number }[], chargeFromMs?: unknown): number {
  const last = window.at(-1);
  if (!last) return 5;
  const from = typeof chargeFromMs === 'number' && Number.isFinite(chargeFromMs) && chargeFromMs <= last.endMs ? chargeFromMs : last.startMs;
  const seconds = Math.round((last.endMs - from) / 1000);
  return Math.min(60, Math.max(5, Number.isFinite(seconds) ? seconds : 5));
}
