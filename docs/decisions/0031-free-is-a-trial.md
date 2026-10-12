# 0031 — Free is a trial, given once: one meeting of up to fifteen minutes

**Status:** proposed · 2026-10-12 · amends ADR 0027's Free plan

## Context

ADR 0027 made Free a small plan that renewed every month: 2 imported calls,
1 "Find insights", 5 questions and 10 live minutes, for one seat. The owner
asked (2026-10-12) for the plans to make sense as a business, with the AI
not consuming what the plans bring in, and for Free to be "just 1 meeting for
15 mins as a trial".

What a seat costs us at full use, from production's usage log (per-feature
averages, scaled to hour-long calls) and the published prices on 2026-10-12:
Sonnet 5 $2 / $10 a million tokens, Haiku 5.5 $0.10 / $0.50 (ADR 0030),
Deepgram Nova-3 streaming $0.0077 a minute a side at list ($0.0048 on its
current promotion), Dodo Payments 4% + 40¢ + 0.5% for a subscription.

| A unit of allowance | What it runs | Cost to us |
|---|---|---|
| Imported call (an hour) | T1 scoring, ~11 windows on Haiku 5.5 | ~$0.005 |
| "Find insights", follow-up, actions or prep | One Sonnet read of the call | ~$0.035 |
| Pattern run | Up to five Sonnet write-ups | ≤ $0.10 |
| Question to Ask | Up to seven Sonnet calls (ADR 0018) | ~$0.03 |
| Live minute | Deepgram both sides $0.0154, detection, suggestions and Assist ~$0.004 | ~$0.02 |

| Plan, per seat | Price | Payment fee | AI and transcription at full use | Left |
|---|---|---|---|---|
| Starter | $9.99 | $0.85 | $2.72 (live $1.17, questions $0.75) | **$6.42, 64%** |
| Pro | $19.99 | $1.30 | $8.51 (live $3.51, questions $3.00) | **$10.18, 51%** |
| Incognito | $59.99 | $3.10 | $8.51 | **$48.38, 81%** |
| Free, as it was | $0 | — | ~$0.55 every month, for as long as the company exists | −$0.55 a month |
| **Free, now** | $0 | — | **~$0.45, once** | −$0.45 once |

Full use is the worst case; most seats use a fraction. Infrastructure
(Vercel, Supabase) is not in these figures. The two lines that decide Pro's
cost are live minutes, which are Deepgram's price rather than the model's,
and questions to Ask, which run on Sonnet.

## Decision

1. **Free is fifteen live minutes and one imported call of up to fifteen
   minutes, with its one "Find insights" and five questions, given once.**
   One meeting, live in the overlay or imported, is the trial.
2. **Two columns on the catalogue keep it a row, not code:**
   - `plans.renews`: false gives the allowance once. Such a plan's period
     never ends, so what was used stays used.
   - `plans.max_call_minutes`: the longest call the plan imports. The import
     route checks it and gives the charge back when a call is longer.
3. **One function says when a period ends** (`private.period_end_for`), for a
   new company, a change of plan and the monthly rollover. A company that
   moves to Free from another plan starts its trial afresh, as moving to any
   plan starts that plan's allowance. That includes a cancelled or ended paid
   plan, which has already paid.
4. **The words come from the row.** The welcome page, the landing page's
   pricing, the plan panel, the banner and the 402 message say "once, as a
   trial", not "a month". The welcome page used to type the allowance out by
   hand, which is how it went stale.

## Consequences

- A company that never upgrades costs at most about $0.45, once.
- After the trial a Free company keeps reading, searching, exporting and
  deleting. Every AI feature answers with the plan page, as a used-up
  allowance always has.
- Companies already on Free keep the period they are in, which no longer
  ends; what they used this month counts toward the trial. None were on Free
  when this was applied.
- `max_call_minutes` is enforced by the import route, the one path that
  scores a call. Storing a long call through the database function directly
  costs no AI.
- **The margins above assume every AI path is metered.** On 2026-10-12 Assist
  and live suggestions were not: they needed only some live minutes left,
  so a Free account could call Sonnet up to the rate limits. The security
  review that found this meters them separately.
- If Free should renew monthly after all, it is one row:
  `update plans set renews = true where id = 'free'`.
