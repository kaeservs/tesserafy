# 0024 — Calls are logged to the company's own CRM, HubSpot first, as one note on the customer's record

**Status:** proposed · 2026-10-04

## Context

A call's score, what it rests on, and its action items lived only in
Tesserafy. Sellers and their managers work from the CRM. Cluely-style tools
put the call there. The owner chose HubSpot first.

## Options

- **How the company connects HubSpot.**
  - **A private app token pasted by the owner.** This is the shape of a
    company's tracker (ADR 0015). Nothing has to be registered on our side and
    there is no marketplace review. The company's admin decides the scopes in
    their own HubSpot, and the token does not expire.
  - **A public OAuth app.** One click for the owner, but it needs our app
    registered with HubSpot first, and its tokens last 30 minutes and must be
    refreshed and stored. It becomes worth it with many customers, or once
    HubSpot retires private apps.
- **What is written.**
  - **A note on the company record.** Every HubSpot plan has notes. They are
    readable and hold the score with its quotes.
  - **A Call engagement with the transcript.** That moves the whole meeting
    into another system the customer may not have meant to hold it in, and
    it duplicates what Tesserafy keeps under erasure and retention.
  - **Updating deal properties.** This needs a mapping per company from
    criteria to fields. It may come later; it is not the first step.
- **When it is written.**
  - **When someone presses Log on the call page.** Nothing is sent without a
    person choosing to send it.
  - **Automatically after every call.** Needs a background job the web app
    does not have, and sends every call, including ones nobody meant for the
    CRM.

## Decision

**A private app token, one note per call, logged when a person presses Log.**

- **The connection is sealed like a tracker's.**
  - The owner pastes the private app's token on Settings → "Where calls are
    logged". It is checked with HubSpot first: which account it is, and
    whether it can read companies.
  - It is sealed by the web server under its own key `CRM_TOKEN_KEY`, with the
    company bound in, and stored in `company_crms`. Members can select every
    column but the ciphertext.
  - `crm_events` records who connected and who disconnected. Closing the
    company forgets the CRM.
- **One path to the token.** `crm_for_call` returns it for a call in the
  caller's own company, and never to a support session
  (`private.in_support_session()`, shared with ADR 0023).
- **The note.**
  - It goes on the HubSpot company whose `domain` matches the domain of the
    call's customer in Tesserafy. With no customer, or no matching company, it
    is refused with a reason, never put on a guessed record.
  - It carries the scorecard with each met criterion's quote, the action
    items, and a link back to the call. Everything from the call is
    HTML-escaped. No transcript is sent.
- **One note per call.** `crm_logs` keeps the note's id. Logging again
  rewrites that note, and makes a new one if it was deleted in HubSpot. The
  log goes with the call when it is erased, and it is in the export.
- **Failures.**
  - A 401 or 403 from HubSpot is saved on the connection (`last_error`) and
    shown to the owner on Settings, with the token form open again.
  - Anything else goes through `recordFailure`.
- **Limits.** `api/crm` allows 10 a minute and 300 a day per account. No AI
  is called, so no allowance is spent.

## Consequences

- **Switching it on** needs `CRM_TOKEN_KEY` in the web app's environment. Then
  each company's owner creates the private app in their own HubSpot. The
  scopes asked for are companies and contacts, read and write. Whether
  HubSpot needs all four to write a note on a company will be confirmed on
  the first real connection, and the list trimmed if it does not.
- **A call reaches the CRM only with a customer that has a domain.** The call
  page says so and the button waits.
- **Other CRMs** are a new `provider` value and a new client. Salesforce needs
  OAuth, since it has no private app tokens, so it comes with that work.
- **Contacts** are not associated yet. Tesserafy does not know who was on a
  call by address. The calendar's attendees (ADR 0021) can be used once a
  call is tied to its meeting.
