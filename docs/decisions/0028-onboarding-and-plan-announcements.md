# 0028 — First-run steps and plan announcements are each person's, kept in the database

**Status:** proposed · 2026-10-05

## Context

A new owner, on Free or a paid plan, landed on Home with nothing to tell them
what to do first. The owner asked for three things:

- a short interactive onboarding, which says more about the plan for someone
  who pays;
- a popup after a change of plan saying what it changed;
- for Free, a banner with its limits and an Upgrade now button, and the
  prices on Home.

Both the onboarding and the popup are shown once. Something has to remember
that they were.

## Options

1. **The browser's storage.** Nothing to migrate. But a person who signs in on
   a second computer, or clears their browser, gets the tour again. And the
   popup cannot tell which plan the person last saw: storage only knows what
   this browser saw.
2. **A column on the company.** One announcement for the company. But
   whoever opens Home first dismisses it for everyone, so the colleague who
   never saw it is never told.
3. **Each person's preferences row (chosen).** Two columns:
   - `onboarded_at`: when they finished or skipped the steps;
   - `plan_seen`: the plan they were last shown.

## Decision

Option 3. `user_preferences` gains `onboarded_at` and `plan_seen`. Both are
read and written only by the person, under the table's existing RLS.

- `finish_onboarding()` records both: finishing the steps is also seeing
  the plan.
- `mark_plan_seen()` records the company's current plan. There is no
  argument, so a person cannot claim to have seen a plan they are not on.

**Everyone already here is backfilled** as onboarded and as having seen
their company's plan. Nobody already using the product gets the tour, or a
popup about a plan they chose before this existed.

**The popup is a comparison, not an event.** It shows when `plan_seen`
differs from the company's plan, wherever the change came from: an owner's
upgrade, Stripe's webhook, a downgrade at the end of a period, a trial
running out, or an operator. No code path has to remember to announce
anything. It shows on any page, once for each person, and never on top of the
tour.

**What a plan includes is worded from the `plans` table, never hard-coded.**
`lib/plan-catalog.ts` does the wording; the table is the catalogue (ADR 0027).

- The onboarding's plan step shows the price × seats, the seats used, and
  each seat's allowance.
- The popup shows the lines that differ from the last plan seen.
- The banner and the plans on Home show the same facts.

A change of limits is a row, and every one of these follows it.

**The tour ticks its own steps.** A step is ticked from what has actually
happened: the overlay has signed in (`overlay_seen`), or the company has a
call. The tour opens on the first step not done, so a person who leaves for
the sample call comes back to the next step.

The tour is shown to everyone new, not only owners. A member's plan step
says what their seat includes, and that an owner changes the plan.

## Consequences

- **An operator in a support session sees what the person would see.**
  Pressing Skip there records it for that person. This is acceptable, since a
  support session exists to see the person's account as they do.
- **Free is announced on every page.** The banner replaces Home's plan strip
  for Free; the strip remains for the old trial and for a plan near its
  limit.
- **Home's plans upgrade the way Plan and billing does.** It is the same
  server action and the same rules:
  - at once while payments are off;
  - through Stripe's checkout once they are on;
  - in Stripe's billing page once the company pays there.

  Seats, moving down and cancelling stay on Plan and billing.
