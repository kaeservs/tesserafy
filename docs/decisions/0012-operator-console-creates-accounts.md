# 0012 — The operator console creates accounts

**Status:** proposed · 2026-09-25 · amends invariant 3 (CLAUDE.md)

## Context

Invariant 3 said the operator console holds the service-role key and uses it
for one thing: minting a session for a user whose account an operator has
recorded a reason for opening.

There was no way for a pilot customer to get an account. The login form will
not create one (`shouldCreateUser: false`), there is no sign-up page, and
checkout — which will eventually create a company when a brand pays — does
not exist yet and is waiting on Stripe. The only route was hand-written SQL
against production, which the project rules out.

The owner chose operator onboarding over a self-serve sign-up page, which
would need a working email provider first, and over leaving it manual.

Creating a login account is an Auth admin call. Like minting a session, no
signed-in user can make it for somebody else, and it needs the service-role
key.

## Decision

The console may use the key for a second Auth admin call: **creating an
account, or a sign-in link for an existing one, for a person an operator has
already recorded provisioning.** It is the same shape as support sessions:

1. `open_account_provisioning` runs as the operator. It checks that they are a
   platform admin, validates the request (the email; a new company or an
   existing one; a new company's first person is its owner; one company per
   person), and writes an `account_provisioning` row before anything exists.
2. `createAccountFor` uses the key. It generates an invite link, which creates
   the account, or a magic link if the address already has one. It does not
   touch a table.
3. `complete_account_provisioning` runs as the operator. It checks that the
   account the key returned has the recorded email and is in no company, then
   creates the company if it is new, adds the membership, and closes the row.
   Only the operator who opened a row can close it.

The key still cannot read a conversation, decide who is an admin, create a
company, add a membership or write an audit row. Every one of those happens
in the database, as the operator, after the check.

The operator sends the link themselves. There is no email provider yet, and a
link in the operator's hands can go by whatever channel the pilot already
uses. An invite link lands on "choose a password" in the web app, where the
person sets one through their own session, so that later sign-ins do not
depend on email either.

## Consequences

- Invariant 3 now names two uses of the key, both Auth admin calls, both
  preceded by a record the operator writes as themselves.
- A failure between steps 1 and 3 leaves an open row, shown in the console as
  "did not finish". That is the honest record: something was attempted.
- One company per person is enforced here because much of the product
  resolves "the caller's company" and refuses to guess between two. Staff
  reach a customer's account through a support session, not a membership.
- A link is valid for the project's OTP expiry, one hour. The console says
  so.
- A checkout webhook can later create companies through the same pair of
  functions, if it runs as a platform admin, or through a sibling that shares
  their checks.

## Alternatives

- **A self-serve sign-up page.** The eventual front door, but confirmation
  emails need an email provider, and Supabase's built-in mailer sends two an
  hour. Blocked on the Resend account.
- **Let the key write the company and membership too.** One call instead of
  three, and it would make the key a general-purpose writer. The ordering
  that makes support sessions trustworthy (decide and record first, as a
  named operator) would be lost.
- **Hand-written SQL.** What happened before. Nothing records who did it or
  why, and it is exactly the ad-hoc production change the project forbids.
