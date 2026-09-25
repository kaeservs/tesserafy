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

`apps/web/lib/ticket.ts` builds an issue body and posts it to `api.github.com`.
A tracker repository is usually readable by an entire engineering organisation
and is sometimes public.

This is the only egress the product itself initiates, and the only one that
cannot be recalled: once something is an issue body it is in that system's
history, its notifications and its search index. A human approves each one,
which is a real control and not a sufficient one.

**Narrowed.** The body carries redacted quotes, a timestamp and a deep link.
It no longer carries the speaker's name or the conversation title, which were
the two fields that named a person and a customer; calls are numbered instead,
so "three calls said this" survives without saying whose. `TicketCitation` has
no field for either, and the route does not select the columns, so a later
change cannot append them by forgetting why.

Quotes still leave, deliberately. They are what lets an engineer judge the
claim without an account in this product, and redaction has already removed
the addresses and numbers a pattern can find. What it cannot find is a name
said out loud mid-sentence — "I'll check with Priya" — so the residue here is
a name inside a quote, and the control for it is the human approving the
issue.

**Open.** Dropping quotes entirely, leaving the summary and the links, would
close the residue at the cost of making every ticket unreadable without a
login. Not taken: a ticket nobody can evaluate gets ignored, and an ignored
insight is the failure mode this product exists to prevent.

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

## Looking at somebody's account

Support access is impersonation, and it is worth being plain about that: the
session is that user's session, with their RLS view, and every action it takes
is attributed to them. `erasure_events.requested_by` will say they erased the
conversation.

The capability was never the new part. Anyone holding the service-role key
could already mint a session for any address through the Auth admin API — the
QA script does it for the probe account in ten lines. What was missing was
accountability, so that is what was added:

- `platform_admins` names who may do it. There is no RPC that adds a row, so
  the only way in is the service role. A self-service path to cross-tenant
  access is the whole vulnerability.
- `open_support_access` decides and records, as the admin, before anything is
  minted. The tooling holds the service-role key only to mint; every
  authorisation decision is made by the database as a named person, because a
  tool that authorises itself writes whatever audit trail it likes.
- Sessions carry a reason in free text and expire, at most four hours.
- `support_access` is never erased. A conversation can be; the fact that a
  member of staff opened this customer's account cannot, because that is the
  record someone may one day need against us.

The console that does this is `apps/admin`, deployed separately from the
customer app because it holds the service-role key and the customer app must
never. The key is used for one thing there — minting the session — and
everything an operator reads goes through RLS as them, against functions that
check `is_platform_admin()` for themselves.

The session it hands over is an ordinary magic link. Supabase sends it to the
Site URL when the request names no redirect or one missing from the allow-list;
the console checks where each link will actually land and says so when it is
wrong, and the product forwards a session that arrives at the wrong door to the
page that can read it. The first version nested `redirect_to` where the REST
endpoint does not read it, and the resulting fallback was wrongly blamed on the
allow-list.

Its sign-out is scoped local, which sounds like a detail and is not: Supabase
signs out globally by default, so a customer who reached the console by mistake
would have been signed out of the actual product on every device they own, for
failing a check they were never meant to pass.

While a support session is open, every page of the account shows a banner
naming the reason and the time left — to the customer and to the operator
alike, because the product cannot tell their sessions apart and should not
try. It reads the account's own `support_access` rows, which RLS already let
the user see.

Two limits, stated plainly:

- **Ending or expiring a session closes the record, not the login.** The
  operator's session is an ordinary Supabase session and lives until Supabase
  expires it. Revoking only that session needs its token, which the database
  never holds; revoking globally would sign the customer out as well —
  measured, not assumed. So the duration is enforced on the record and the
  banner, and an operator who keeps working after it has run out is visible in
  the record but not stopped by it.
- **There is no consent step.** The customer is told, not asked.

## Where failures go, and why not to a vendor

The obvious way to see production errors is an error-tracking vendor, and it
was not taken. An error message is useful precisely because the upstream
quotes the request back at you, and here the request is a customer's words: a
model rejection can carry a sentence from a call, an auth failure can carry a
live key. Sending those to a third party would have re-opened, in a worse
form, the egress that flow 1 spent a change narrowing.

Failures go to `public.system_failures` in our own database instead, scrubbed
of credentials and of the identifiers T0 masks, capped in length, and
classified so that a bug of ours can be told from an overloaded model. They
are read by `pnpm health`, which a scheduled GitHub Action runs every four
hours and which exits non-zero when something needs a person.

The rows cascade: erasing a conversation erases the failures recorded against
it, and erasing a company erases all of them. This is the one place the
failure log differs from the cost log, which keeps its rows and merely unlinks
them — a cost row is numbers, and a failure row is a message that may quote
the call it failed on.

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
from two years ago imported yesterday is two years old.

An owner sets the period in the product, under Settings, from a short list
(30 days to two years); the database accepts a week to ten years and refuses
anyone who is not an owner, because a retention period is deletion on a
schedule and only an owner may delete. Before it is saved the owner is shown
how many calls the next run would remove — `retention_preview` counts exactly
as the purge counts — and has to type "delete" when that number is not zero.
Going back to keeping everything needs no confirmation.

The purge runs nightly at 03:15 UTC as a `pg_cron` job inside the database
(`purge-expired-conversations`). No key leaves Supabase for it and nothing in
CI holds a secret to trigger it. `purge_expired_conversations` is unchanged:
it refuses any signed-in caller, and a cron job has none. Each call it removes
goes through `erase_conversation` with the reason `retention`, so the erasure
record says why. A company with no period set is never touched, which is
every company until an owner chooses otherwise.

To see what the job has done:

    select * from cron.job_run_details
     where jobid = (select jobid from cron.job where jobname = 'purge-expired-conversations')
     order by start_time desc limit 10;

## Still open

- **Tickets carry quotes, and nothing else identifying.** Flow 1 above. Names
  and conversation titles are gone from the body and from the query that built
  it; a name spoken inside a quote is the remaining residue, and a person
  approves every issue.
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

- **Production failures now have a destination.** See above. Previously an
  error reached only the browser of whoever hit it, which is how three broken
  tiers survived four merges unreported.
- **Staff access is recorded; ordinary access still is not.** Opening a
  support session against a user writes a `support_access` row first — who,
  whom, why, for how long — and only then is a session minted, so a failure to
  record is a failure to access. The user can read those rows about their own
  account, because an audit trail the audited cannot see is a private diary.

  What is still missing is the ordinary case: RLS decides who *can* read a
  conversation and nothing records who *did*. "Which of our colleagues opened
  this call" is answerable for support sessions and unanswerable for everything
  else.
- **No consent record.** `conversations` has no field for who agreed to being
  recorded, when, or under which jurisdiction. This is load-bearing in
  two-party-consent regions.
- **No data residency choice.** One project, one region.
- **Backups outlive erasure.** A row erased today is still in whatever
  point-in-time backup the platform keeps. Any erasure promise made to a
  customer has to state that window honestly.
