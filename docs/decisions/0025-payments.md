# 0025 — Payments through Stripe, with the webhook's signature checked by the database itself

**Status:** proposed · 2026-10-04

## Context

Plans have been free since they existed. The plans migration said what
payments would be: "starting or upgrading a paid plan moves to checkout and
its webhook calls private.apply_plan". The open question was the webhook.

Stripe reports what happened by calling us. The call arrives as nobody, and
only the database may change a plan. The web app holds no service-role key
(invariant 3). The console holds it, but only for three Auth admin calls, and
it never writes a table.

## Options

- **The webhook in the console, with the service-role key.** This breaks
  "the key never writes a table". It also puts a public endpoint on the
  internal deployment.
- **A Supabase Edge Function with the service-role key.** The key stays
  inside Supabase, but it creates a new holder of the key that writes tables,
  and a second runtime to deploy and test.
- **The database checks Stripe's signature itself.**
  - `stripe_event(payload, signature)` may be called by anyone.
  - It checks Stripe's HMAC against the signing secret, which is held in a
    private-schema table no API role can read, before it reads anything in
    the event.
  - The web route forwards the exact bytes and the header.
  - Nothing new holds a key. An unsigned, altered, stale or repeated event
    changes nothing.

## Decision

**The database checks the signature.**

- **Signature.**
  - `private.stripe_signature_ok` computes Stripe's scheme: HMAC-SHA256 of
    `t.payload` keyed by the whole `whsec_` secret, in UTF-8.
  - It allows five minutes of clock difference.
  - A test pins it to a vector made with Node's crypto, non-ASCII included.
- **No replays.** Each event id is recorded once in `stripe_events`, which
  operators can read. A second delivery is a no-op.
- **What each event does.**
  - `checkout.session.completed`: links the Stripe customer and subscription,
    and starts the plan named in the session's metadata, for the company in
    `client_reference_id`.
  - `customer.subscription.created` and `.updated`: set the plan from the
    price, the period from Stripe (from the subscription or its item,
    whichever the API version carries), and whether it cancels at the
    period's end.
  - Status `canceled`, `unpaid` or `incomplete_expired`, or `.deleted`: the
    plan is ended. The customer is kept for the next checkout.
  - `past_due` keeps the plan while Stripe retries.
- **What the operator sets** (console → Payments, recorded in
  `payment_setting_events`):
  - the signing secret, of which the console sees only the last four
    characters after saving;
  - which Stripe price each paid plan is sold at (`plans.stripe_price_id`).
- **When payments are on.** Payments are on when both of those are set
  (`payments_ready()`). Then:
  - `change_plan` refuses to start or raise a paid plan for free, so it goes
    through checkout;
  - a company paying through Stripe changes and cancels in Stripe's billing
    page, not here;
  - a free Basic or Pro from before runs to the end of its period and stops,
    instead of renewing for free.
- **Checkout and billing** are made by the web app with `STRIPE_SECRET_KEY`.
  - Use a restricted key: Checkout Sessions and Customer portal, write.
  - `billing_checkout` decides who may: an owner, not a support session, not
    pilot or internal, not already paying.
  - It reuses the company's Stripe customer.
  - The company and plan go both on the session and on the subscription it
    makes, so events find the company in any order.
- **Periods.** For a Stripe subscription, periods come from Stripe. The
  nightly roll already leaves any provider but `none` alone, and usage is
  counted from each period's start.

## Consequences

- **Turning it on** is four steps, listed on the console's Payments page:
  1. Products and monthly prices in Stripe.
  2. The webhook endpoint `/api/stripe/webhook`, for those four events, with
     its secret pasted in the console.
  3. The customer portal, with switching between the two prices and
     cancelling at the period's end.
  4. `STRIPE_SECRET_KEY` in the web app.

  Until all are done, plans stay free. If the database is ready but the web
  app has no key, plan buttons explain that a paid plan starts at checkout.
- **Turning it on ends free plans.** Free Basic and Pro plans stop at their
  next period end. Owners see "Pay for Basic to keep it" until then.
- **Some Stripe-side actions do not reach us.**
  - An operator's `admin_set_plan` or closing a company does not cancel a
    Stripe subscription. That is done in Stripe's dashboard; the console
    shows how many companies pay.
  - A refund or a dispute does not change a plan by itself.
- **Event handling is SQL.** It is tested in pgTAP (`payments.test.sql`),
  covering a signed checkout, a plan change, a cancel at period end, the end
  of a subscription, and every way an event is refused.
- **Tax and invoices** are Stripe's, and depend on the company's country,
  which is still to be decided.
