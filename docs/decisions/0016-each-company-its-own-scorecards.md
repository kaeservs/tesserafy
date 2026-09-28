# 0016 — Each company writes its own scorecards

**Status:** proposed · 2026-09-28 · amends the criteria convention in CLAUDE.md ("an operator with the service role, never a browser")

## Context

A criteria set decides what every score in the product means. Until now there
was one kind: product-level reference data in `criteria_definitions`, written
by an operator with `pnpm criteria --add`. Every company scored its calls
against Tesserafy's discovery set, or another set an operator published for
everyone.

That is not what a brand buys a scorecard for. It wants its calls measured
against its own playbook: its demo, its renewal, its version of discovery.
Asking an operator to publish each company's set would put Tesserafy in the
middle of every customer's sales process, and a set published for one company
was visible to all of them.

The original reason for keeping sets out of the browser was that editing one
mid-quarter would silently re-score history. Versions already solve that. A
conversation pins the `(engagement_type, criteria_version)` it was scored
against, and a published version is immutable.

## Options

- **Keep operator-only publishing.** Nothing to build; the product stays
  unable to do its core job for any company whose calls are not discovery
  calls.
- **A separate `company_criteria` table.** Clean ownership, but every reader
  — the scorecard read path, live scoring, the overlay, export, the scripts —
  would have to ask two tables and merge them. `record_criterion_events` and
  the pinning trigger would each need a second branch.
- **A nullable `company_id` on `criteria_definitions`.** The table's first
  migration anticipated exactly this. No company means a template everyone
  reads; a company means that company's set, which only its members read.

## Decision

**A nullable `company_id` on `criteria_definitions`**, plus one rule and one
function.

- **The rule:** a company's set may not take a template's name, and a template
  may not take a name a company already uses. A trigger enforces both
  directions. For any one company an engagement type therefore means exactly
  one set. A conversation's pin stays two columns, unambiguous without a
  company qualifier, and nothing that reads a pin had to change shape. Two
  companies may each have a "demo"; neither can see the other's.
- **Reads name their company.** `fetchCriteria` and `fetchCriteriaSets` take
  `companyId` as a required argument (null for templates only), the same way
  `retrieve()` does. RLS already hides other companies' sets from a member,
  but an operator reads every company's, and so do service-role scripts. A
  read that did not say whose "demo" would get whichever row came back first.
  The web app takes the company from the caller's own membership, never from
  `companies`, where an operator sees every row.
- **Scope in the database.** The pinning trigger and `record_criterion_events`
  accept a template or the conversation's own company's set, never another
  company's. The same name and key from elsewhere are not evidence.
- **`publish_scorecard`** (owners only, SECURITY DEFINER) validates everything
  the scoring engine and detector depend on: a slug name that is not a
  template's; 2 to 12 criteria with unique keys; names up to 60 characters;
  descriptions of 20 to 600, because the description is the detector's
  prompt; weights from 0.5 to 3; ordered thresholds. It writes the next
  version with `published_by`. Nothing edits a published version.
- **Try before publishing.** `/api/scorecards/try` runs a draft over up to
  three of the company's recent calls, in the same 48-utterance windows as an
  import (ADR 0014), capped at 15 windows (~$0.17). It scores them in memory
  with `@tesserafy/scoring` and writes no evidence. It is charged as one
  imported call, refunded when nothing reached the model, rate-limited, and
  its model usage is recorded under the `-try` detector.
- **Templates stay an operator's**, through `pnpm criteria --add`, which now
  refuses a name a company uses before the database has to.
- **The console reads, does not write.** A company's page lists its sets
  through the operator's own RLS session. Changing a company's scorecard is
  its owner's job.

## Consequences

- Owners see Scorecards in the web app: their own sets and the templates,
  each with its full criteria and every version, with the number of calls
  each version scored. Members read the same pages and cannot publish.
- Import's "Score it as" lists the newest version of each set, the company's
  own first. It sends the name and version as one value, so a call is pinned
  to the version it was shown. It used to send only the name, which pinned
  version 1 whatever the picker said.
- Existing calls are not re-scored when a new version is published. Moving
  calls to a newer version is a deliberate act: an owner presses "Move calls
  to version N" on the scorecard's page, ten at a time, each re-scored from
  its transcript and charged as an imported call — or changes one call's
  scorecard under "Edit this call".
- The overlay asks `/api/criteria/sets` which scorecards the signed-in person
  may use and remembers the choice, by name, on that computer, so a newer
  version is picked up without choosing again. It reaches customers with the
  next desktop release.
- An operator's account in the web app sees only its own company's sets.
- A company closed with its own sets keeps them as rows, like the rest of a
  closed company's tombstone. Deleting the company cascades them.
- `criteria_definitions` gains a surrogate `id` primary key; the natural key
  is a unique index over `(coalesce(company_id, zero), engagement_type,
  version, key)`.
