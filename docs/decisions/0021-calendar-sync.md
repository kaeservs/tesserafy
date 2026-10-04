# 0021 — Each person connects their own calendar, read-only, and only customer meetings are kept

**Status:** proposed · 2026-10-04

## Context

Call preps were made by hand: the seller typed who the call was with and
when. Cluely knows your upcoming meetings from your calendar. The owner chose
to build calendar sync next.

## Options

- **Sign in with Google or Microsoft (OAuth), read-only.** One click per
  person. It covers both calendars and gives attendees and meeting links. It
  needs an app registered with each provider. Google treats calendar access as
  a sensitive scope: until its review, people see an "unverified app" warning
  and at most 100 can connect.
- **A private calendar link (ICS) pasted by the person.** Nothing to register,
  but Outlook's published links leave out attendees, so the meeting cannot be
  told apart from an internal one or tied to a customer.
- **The company's calendar, via an admin-granted app.** Reads everyone's
  calendar at once. That is more than a seller agreed to, and it puts internal
  meetings in reach.

## Decision

**Each person signs in with Google or Microsoft, read-only, for their own
calendar.**

- **Least data.**
  - **Scopes:** Google `calendar.events.readonly`; Microsoft `Calendars.Read`
    (with `User.Read` and `offline_access`).
  - **What is read:** the next 14 days. Only meetings with at least one
    attendee outside the person's own email domain are kept, and only those
    attendees. Each meeting keeps its title, time, attendees and meeting link
    (`https` only).
  - **Never read in:** descriptions. All-day items, cancelled meetings and
    rooms are dropped.
- **The refresh token** is sealed by the web server before it is stored. It
  uses AES-256-GCM with the person's id bound in, under its own key
  `CALENDAR_TOKEN_KEY`, the same scheme as tracker tokens. The sealing is now
  one module, `lib/sealed.ts`, used by both. Microsoft rotates refresh tokens,
  and the new one is sealed and kept on each sync.
- **Personal.** People read only their own connection and meetings (RLS).
  Neither owners nor operators see them.
- **Sync on demand.** Prepare and Home re-read a calendar not read in the last
  15 minutes. "Read my calendar now" forces it. There is no background job, so
  nothing is read for someone who is not using the product.
- **One click to a prep.** The prep gets who (the first outside attendee),
  which customer (an account whose domain matches theirs), and when. The brief
  stays a separate press, because writing it spends the plan's allowance.
- **Failures.** A refused grant is saved on the connection and shown on the
  Account page. Anything else is also recorded for `pnpm health`.
- **Disconnecting** revokes the grant (for Google, through its revoke
  endpoint), then removes the connection and every meeting it brought in.
  Preps made from them stay.
- **The sign-in round trip** carries a random state, checked against a
  short-lived cookie, so a link made by someone else cannot attach the wrong
  calendar.

## Consequences

- **Until set up**, the Account page says calendar sync is "not switched on
  for this deployment yet". Each provider needs its app registered
  (`GOOGLE_CLIENT_ID/SECRET`, `MICROSOFT_CLIENT_ID/SECRET`) and
  `CALENDAR_TOKEN_KEY`.
- **Before Google's verification**, Google sign-ins show "unverified app" and
  are capped at 100 users. Verification needs a privacy policy and a homepage,
  both of which the lawyer and landing-page work provide.
- **The overlay** takes its next call from preps, as before. A meeting becomes
  the overlay's call once it is prepared.
