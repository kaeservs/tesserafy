# Data protection

This product records what customers say in meetings. That makes almost every
engineering decision here a data-protection decision too, so this file records
what actually happens to that content — audited from the code, not from
intent — and what is still open.

Last audited: 2026-09-22.

## What leaves the tenant

Four flows carry meeting content past the boundary that RLS defends. They are
listed worst first, where "worst" means hardest to undo.

### 1. Tickets, into an external tracker

`apps/web/lib/ticket.ts` builds an issue body containing verbatim customer
quotes, the speaker's name and the conversation title, and posts it to
`api.github.com`. A tracker repository is usually readable by an entire
engineering organisation and is sometimes public.

This is the only egress the product itself initiates, and the only one that
cannot be recalled: once a quote is an issue body it is in that system's
history, its notifications and its search index. A human approves each one,
which is a real control and not a sufficient one.

**Open.** The ticket needs a *link* to the evidence far more than it needs the
evidence. Replacing the quotes with a link would close this at the cost of a
click for the reader.

### 2. Audio, to a browser vendor

The live path uses `webkitSpeechRecognition`, so the customer's voice is
streamed to Google or Microsoft. `apps/web/components/live-microphone.tsx`
says so on the page rather than in a comment. Spike S2 exists to replace it.

Until S2 lands this is an instrument, not a product, and no customer call
should run through it.

### 3. Transcript windows, to Anthropic

Inherent: the detectors cannot detect without the text. What is controllable
is *how much* — the rolling window is three utterances, not the call — and
what the text contains, which is what redaction below is about.

### 4. Where it all rests

The Supabase project is in `ap-southeast-1`. For a customer in the EU or the
UK that is a transfer question before it is a technical one, and it is not
currently configurable per tenant.

## What the product does well

Worth stating, so the gaps are read against the right baseline.

- **One audited tenant boundary.** Exactly one function may construct a vector
  query and `companyId` is its first argument (ADR 0004), with a cross-tenant
  test that must stay green. The AI pipeline runs with a service-role key that
  bypasses RLS, so this function — not RLS — is the real control, and it is
  small enough to read.
- **No transcript text in logs.** Telemetry records token counts, durations
  and model names. Audited 2026-09-22: nothing logs segment text.
- **No fabricated attribution.** A stored quote must match its segment
  character for character, enforced by a trigger on every table that holds
  one. The product cannot put words in a customer's mouth.
- **No credential in the browser.** The service-role key never reaches client
  code (`createServiceClient` throws if `window` exists), and the Electron
  overlay is told only whether a token exists, never its value.
- **Live capture asserts nothing.** A browser may say what was said; quote
  offsets are derived server-side, criteria cannot be invented, and another
  conversation's segment cannot back this one's evidence.

## Erasure

A customer may ask for a meeting to be deleted, and before 2026-09-22 that
request could not be honoured. Not "was not implemented" — *could not*:
`insight_evidence_keeps_insight_backed` raises `23514` when the last evidence
for an insight is removed, so deleting a conversation whose signals solely
supported an insight failed. Invariant 4 outranked the right to be forgotten.

`erase_conversation()` resolves it by deleting such an insight along with the
conversation. That is invariant 4 applied rather than weakened: this product
refuses to display a claim it cannot evidence, and once the evidence is gone
the claim is exactly that. An insight supported by several conversations keeps
working with fewer citations, as it always did.

What goes: the conversation, its segments, **their embeddings** — the copy
people forget, since a 768-dimension vector of a sentence is still derived
from that sentence — its signals, their quotes, its criterion events, and any
insight left unevidenced. What stays: the cost telemetry, with its link to the
conversation nulled. The money was spent and cannot be reconstructed later; an
opaque id pointing at nothing is a thread worth cutting.

The erasure log records **that** an erasure happened and never **what** was
erased. Counts, ids, who asked, when. A log naming titles or quotes would
itself become a thing you have to erase, which is how "we deleted it" turns
out not to be true. The single exception is the URL of any ticket already
raised from the erased conversation: that content left before the erasure and
cannot be recalled from here, so the log says where it went and a person
finishes the job.

    pnpm erase --conversation <uuid>
    pnpm erase --log --company <uuid>

Erasure is reachable by a company **owner** as well as an operator, so a
customer request need not queue behind us. It is not offered as a button
anywhere yet: it cannot be undone, and a confirmation dialog is a weaker guard
than having to be an operator at a terminal.

## Retention

`companies.retention_days` is per tenant and stored as data, for the same
reason criteria are — a customer asking for ninety days should be a row, not a
deploy. Null keeps conversations indefinitely, which is the current default
and is a position, not an absence of one.

    pnpm erase --company <uuid> --retention 90
    pnpm erase --purge

What expires is the meeting, not the import: `occurred_at` decides, so a call
from two years ago imported yesterday is two years old. The purge is
operator-only and runs nothing on a schedule yet — wiring it to `pg_cron` or
to CI is the obvious next step and deliberately not done silently.

## Still open

- **Tickets carry quotes.** Flow 1 above. The largest uncontrolled egress and
  the cheapest to close.
- **Redaction is done, with a stated limit.** Email addresses, phone numbers
  and account-length digit runs are masked at T0, before anything is stored,
  so they never reach segments, embeddings, prompts, ticket bodies, the search
  index or a backup. It is irreversible by design, and the stored transcript
  is no longer literally what was said.

  It does **not** remove names, including speaker labels, and must not be
  described as anonymisation. A pattern cannot tell a person from a company
  from a product, and one that tried would delete the evidence — "Northwind's
  export is slow" is the finding. Money and durations are protected
  explicitly: masking "90 minutes every morning" would remove a quantified
  pain and nobody would ever know it had been there.

  It has no second line of defence by design, which is why `pnpm qa` uploads
  a transcript carrying an address and asserts the stored segment does not.

- **No access log.** RLS decides who *can* read a conversation; nothing
  records who *did*. "Which of our staff opened this customer's call" is
  currently unanswerable.
- **No consent record.** `conversations` has no field for who agreed to being
  recorded, when, or under which jurisdiction. This is load-bearing in
  two-party-consent regions.
- **No data residency choice.** One project, one region.
- **Backups outlive erasure.** A row erased today is still in whatever
  point-in-time backup the platform keeps. Any erasure promise made to a
  customer has to state that window honestly.
