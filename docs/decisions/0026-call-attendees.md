# 0026 — A call keeps who from outside was invited to its meeting

**Status:** proposed · 2026-10-04

## Context

The follow-up email (ADR 0023) and the HubSpot note (ADR 0024) both need to
know who was on the call. The follow-up needs its recipients. The note needs
the contacts to attach to, and the customer's domain when the call has no
customer set.

The calendar knows who was invited (ADR 0021), but it is each person's own.
RLS lets only that person read it, and a meeting leaves the calendar a day
after it ends. Whoever drafts the follow-up or logs the call is often a
colleague, and often later than that.

## Options

- **Read the seller's calendar when needed.** A colleague cannot, and after a
  day nobody can.
- **Ask the seller to type the attendees.** That is the work the calendar
  exists to save.
- **Copy the meeting's outside attendees onto the call when it starts.** The
  attendees become the company's, as the call already is.

## Decision

**Copy them when the call starts.**

- **When.** `link_call_to_meeting` runs as the caller when a live call
  starts, and after an import.
- **Which meeting.** The database finds it in the caller's own calendar: the
  meeting under way at the call's time, or starting within 15 minutes. The
  client never names one.
- **What is copied.** Only addresses and names already kept from outside the
  person's domain (ADR 0021), and the meeting's title. They are copied into
  `call_attendees`.
- **Who reads them.** Members read them as they read the call.
- **Erasure.** They go with the call, and they are in the export.
- **The customer.** If the call has none yet, and one of the company's
  customers has an attendee's email domain, that becomes the call's
  customer.
- **What uses them.**
  - The follow-up's To starts with them.
  - The HubSpot note is put on those who are contacts there (exact address,
    ten at most), as well as the company.
  - With no customer domain on the call, the attendees' domain finds the
    company.

## Consequences

- **Customers' addresses become company data on the call.** This is the same
  footing as the transcript, which already holds what they said. The privacy
  policy should say so (see the lawyer review).
- **Imports** link only if the meeting is still in the uploader's calendar,
  that is, within about a day of it.
- **No calendar connected** means no attendees. The follow-up's To is typed,
  as before.
