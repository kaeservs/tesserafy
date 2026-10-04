# 0023 — Follow-ups are sent from our address in the seller's name, and every send is kept

**Status:** proposed · 2026-10-04

## Context

The follow-up email (ADR 0014's T3 drafts) could be copied, or opened in the
seller's email app through a `mailto:` link. Cluely hands over the follow-up
when the meeting ends. The owner chose Resend for sending it from the call
page.

## Options

- **Send through Resend from Tesserafy's sending address.**
  - The seller's name is on the email, replies go to the seller, and the
    seller is copied.
  - It works as soon as one domain of ours is verified.
  - The customer sees our sending domain, not the seller's.
- **Send from each company's own domain, verified with Resend.**
  - Mail comes from the seller's own address and the domain matches.
  - Every company has to add DNS records, and there is a domain page to build
    and keep checked.
- **Send through the seller's own mailbox (Gmail or Outlook APIs).**
  - Truly from the seller, and it sits in their Sent folder.
  - Gmail's send scope is restricted, which means Google's security assessment
    before anyone outside the test list can use it.
- **Put the seller's address in From while sending through Resend.** That is
  forging a sender. The receiving domain's DMARC rejects it, and it is wrong
  even where it would get through.

## Decision

**Resend, from our sending address, in the seller's name. Each company's own
domain is the next step, not this one.**

- **The email.**
  - From: `"<name the seller typed>" <EMAIL_FROM>`. Reply-To is the seller's
    own sign-in address, and the seller is copied.
  - Plain text only, as the seller edited it on the call page. HTML built from
    meeting words is a way to send something other than what was shown.
- **The record comes before the email.**
  - `begin_follow_up_send` writes `follow_up_sends` as `sending` and checks:
    there is a draft; one to ten real addresses; a sender name that cannot
    forge an address (no quotes, angle brackets or line breaks); not a support
    session (`private.in_support_session()`); at most 30 a company an hour.
  - The record's id is Resend's idempotency key, so a retried request cannot
    send twice.
  - `finish_follow_up_send` settles it, once, by its sender, as `sent` or
    `failed`, with Resend's message id or what went wrong.
- **What is kept, and who sees it.**
  - Members read the company's sends: who, to whom, when, the words. The call
    page lists them.
  - Sends go with the call when it is erased. The sender goes to null with
    their account (ADR 0013). They are in the company's export.
- **Limits.**
  - Per account: 5 a minute and 40 a day (`api/follow-up/send`).
  - Per company: 30 an hour, in the database, however it is asked.
  - Sending calls no model, so it spends no allowance; the draft already did.
- **Failures** are recorded through `recordFailure` and shown to the seller
  as "Not sent".

## Consequences

- **Switching it on** needs `RESEND_API_KEY` and `EMAIL_FROM` (an address on a
  domain verified in Resend, with SPF and DKIM) in the web app's environment.
  Until then the call page offers Copy and "Open in your email app", as
  before. Resend's data processing agreement belongs with the other vendors'.
- **The customer sees our domain.** The seller's name is on it, but the
  address is ours. A company that wants its own domain needs the second
  option above.
- **Reputation.** Everything sent from that domain is our deliverability. The
  limits bound what a stolen session can send, and every send is attributable
  to a person.
