# 0027 — Plans per seat, a Free plan, and undetectability as the Incognito plan

**Status:** proposed · 2026-10-05

## Context

Plans were one price per company: Basic $9 and Pro $20, with a monthly
allowance for the whole company and no limit on its people. The owner had
asked for Starter to be one person and Pro to be you plus two. Cluely, the
reference, charges per person: Pro at $19.99, and "Pro + Undetectability" at
$149.99.

Measured costs (ADR 0014 windows, all post-call work on Sonnet) put the most a
seat can cost at about $3–4 on Starter and $10–12 on Pro. Live calls are the
largest part, at about $1.80 a call-hour, half of it Deepgram. Undetectability
costs nothing to run: it is an operating-system setting on the overlay's
window.

Live calls were open only to Tesserafy's own company. The reason was the
browser's speech recognition, which sends customer audio to the browser's
vendor. Deepgram (ADR 0022) is the transcriber that runs under our terms.

## Decision

**Every paid plan is per seat, and each seat brings its own allowance.**

| Plan | Price | Seats | Each seat, a month | Overlay in a screen share |
|---|---|---|---|---|
| Free | $0 | 1 | 2 imported calls, 1 Find insights, 0 pattern runs, 5 questions, 10 live minutes | shows |
| Starter | $9.99 a seat | any | 10 / 10 / 4 / 25 / 60 | shows |
| Pro | $19.99 a seat | any | 25 / 25 / 10 / 100 / 180 | shows |
| Incognito | $59.99 a seat | any | as Pro | hidden |

- **The allowance follows the seats.** A company's limit on a meter is its
  plan's per-seat allowance times its seats (`private.company_limit`). Every
  function that reads a limit reads that. Cost and revenue grow together, so
  a large team cannot cost more than it pays.
- **Seats.**
  - A company may not have more people than its plan allows: one on Free, the
    seats it pays for on a per-seat plan, and no limit on the plans Tesserafy
    grants (pilot, internal).
  - This is checked by a trigger whenever someone is added, however they are
    added.
  - A company already over its limit keeps everyone, but can add nobody until
    it has room.
  - While payments are off, an owner sets the seats (`change_seats`), never
    fewer than the people there.
  - Once paying, the seats are the Stripe subscription's quantity. It is set
    at checkout (at least one per person already in the company) and changed
    in Stripe's billing page, and the webhook keeps it in step.
- **Free.**
  - A new company starts on Free instead of the fourteen-day trial.
  - A cancelled or ended plan, a trial that runs out, and a Stripe
    subscription that ends all land on Free, not on "no plan". Companies that
    had no plan and are not closed move to Free.
  - Its most cost to us is about $0.50 a month. Assist and the recap stop when
    its live minutes do.
  - The trial stays for the company on it until it ends.
- **Incognito** is the plan that hides the overlay from screen sharing
  (`plans.incognito`; pilot and internal are hidden too).
  - The setup tells the overlay. The overlay starts hidden, so someone who
    pays for it is never briefly visible, and turns protection off once the
    setup says the plan is not Incognito.
  - The tray switch works only on Incognito.
  - Everyone else is told they are visible in a share.
- **Live opens to every plan with live minutes**, Free included, once
  `DEEPGRAM_API_KEY` is set (`liveCallsAvailable`).
  - The browser's own recognition stands in when Deepgram cannot start, but
    only for Tesserafy's own company (`engineFallback`).
  - The web's live test bench stays internal.

## Consequences

- **Undetectability is enforced by the overlay on the user's computer.** A
  modified app could turn content protection on without Incognito. This is
  the same for Cluely. It holds for anyone using the app as shipped, and
  nothing more is claimed.
- **Payments need an Incognito price as well** (console → Payments) before
  they are on, because `payments_ready` requires every plan on sale to have
  one.
- **Live is still off for customers until the Deepgram key is set.** Then it
  is on for every plan at once.
- **The price grows with the team.** A team of five on Pro pays $99.95.
- **Undetectability is priced on what it is worth, not what it costs.** At
  $59.99 it is 60% under Cluely's tier.
