# 0020 — Recording consent is agreed once, Cluely-style, and kept as a record

**Status:** proposed · 2026-10-02 · amends the overlay paragraph of CLAUDE.md ("confirmed per call in a checkbox")

## Context

Before every live call, the overlay and the web microphone asked the seller
to tick "Everyone on this call has been told it is being recorded,
transcribed and analysed, and has agreed to it." The owner wants the overlay
to work like Cluely's: nothing to tick per call.

The box was never visible to the meeting. Content protection keeps the whole
overlay out of any screen share, as measured pixel for pixel. What the box
does is put the legal duty on the user, with a record of it. That record is
what protects the company in all-party-consent jurisdictions, so it had to
survive the change.

## Options

- **Remove it.** This leaves no record that anyone accepted the duty. Rejected.
- **Keep it per call, smaller.** This keeps the friction the owner wants gone.
- **Agree once, and cite that agreement on every call.** This is Cluely's
  model. The responsibility stays with the user, and the record is stronger,
  because it is one deliberate act with the words and the Terms version, not
  one tick among many.

## Decision

**Agree once.**

- **The agreement.** Shown once, in the overlay or on the web
  (`RECORDING_AGREEMENT`, `apps/web/lib/consent.ts`): to tell everyone on every
  call they record, record only with their agreement, and accept that doing
  so is their responsibility under the Terms.
- **The record.** It goes in `recording_agreements`: the exact words, the
  Terms version (`TERMS_VERSION`, `lib/legal.ts`), when, and where. There is
  one row per person, company and Terms version. The person is a plain id
  plus their email (ADR 0013 allows a plain id), so the record survives
  account deletion.
- **Who can read it.** The person reads their own, the company's owners read
  the company's, and operators read every one, on the console's Agreements
  page and per person on each company's page.
- **Enforcement.** `start_live_conversation` refuses a call from someone with
  no agreement, however it is asked. The live route requires an agreement
  under the current Terms version, and writes the call's consent statement
  from it ("Recorded under the agreement made on <date> (Terms <version>):
  …"). Every call therefore cites what it rests on.
- **Changing the Terms.** Raising `TERMS_VERSION` asks everyone again before
  their next recorded call.
- **Imports keep their per-upload confirmation.** That box is a statement
  about one recording that already happened, not a promise about future
  calls.

## Consequences

- Start is one press after the first time, in the overlay and on the web.
- Overlays older than 0.1.14 send the old tick, which the server no longer
  reads, and cannot make the agreement. Their Start is refused until the
  overlay is updated. The web microphone works as soon as this deploys.
- The legal wording is ours until the owner's lawyer reviews it, alongside
  the Terms.
