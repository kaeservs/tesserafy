# 0007 — Signals and their evidence

**Status:** proposed · 2026-09-16

## Context

Phase 1 needs somewhere to put what a detector extracts from a conversation.
The P0 schema stops at `segments`: there is no table for a claim, and no way
to link a claim to the words behind it.

Invariant 4 says every signal, criterion state and insight links to a quoted
span with a timestamp. Until now that has been a rule the pipeline was
expected to follow. Nothing in the database prevented an unbacked row.

Two further pressures shape the design. The P5 gate needs one insight with at
least three evidence items drawn from at least two conversations, so evidence
is many-per-claim before long. And the claims come from a language model,
which will paraphrase a transcript while presenting the result as a quote —
the one failure this product cannot absorb, because a customer who finds a
quotation they never said stops trusting every other quotation on the page.

## Decision

Two tables, `signals` and `signal_evidence`, with the link modelled as a join
table rather than a column.

`signal_evidence` carries the `segment_id` plus character offsets into
`segments.text`, so the UI can highlight the exact phrase within the segment
it scrolls to, and the timestamp comes from the segment itself.

Three guarantees move from convention into the database:

1. **Tenant pinning.** `company_id` is denormalised onto both tables and
   pinned by composite foreign keys, exactly as `segments` pins to
   `conversations` (ADR 0004). A signal cannot cite another tenant's segment,
   whatever the pipeline believes.
2. **Quote fidelity.** A `before insert or update` trigger checks that the
   stored quote is exactly the substring of the segment at the stored offsets.
   A paraphrase is rejected at write time, where it is cheap to notice,
   instead of being discovered by a customer.
3. **No signal without evidence.** A deferred constraint trigger rejects, at
   commit, any signal with no evidence row — and rejects deleting the last
   evidence row from a signal that still exists. Deferred because a signal and
   its evidence are written in that order within one transaction.

RLS follows the P0 shape: select-only for members of the owning company, no
write policies at all, so writes belong to server code holding the service
role.

## Consequences

Every evidence read is a join. At this data volume that is free, and the two
covering indexes on `(company_id, signal_id)` and `(company_id, segment_id)`
serve both directions — the signal's evidence list, and "which signals cite
this segment?", which is the click-through in the P1 gate.

Extraction code must write a signal and its evidence in one transaction. A
detector that streams claims one at a time cannot commit between them; this is
a real constraint on the ingest path, and it is the intended one.

The quote-fidelity trigger means the extractor must return offsets, not just
text. Prompting a model for character offsets is unreliable, so the ingest
path should have the model return the quote and then locate it in the segment
itself, failing loudly when the quote is not found verbatim. That failure is
the signal that the model paraphrased.

`kind` is constrained to `problem` and `feature_request` by a check
constraint. Adding a kind is therefore a migration, which forces the eval set
in Phase 3 and the UI to be updated in the same change rather than silently
diverging.

## Alternatives

**A `segment_id` column on `signals`.** Simplest, and wrong by P5: one signal
would be limited to one span, so the insight gate would require migrating the
column away. The join table costs one table now and nothing later.

**Evidence as a JSON column.** Fastest to write and the weakest: a foreign key
cannot point into JSON, so neither tenant pinning nor the existence of the
segment would be enforceable. The invariant would return to being a promise.

**Enforcing the quote in application code only.** The pipeline is the thing
most likely to be wrong, and it is not the only writer — seeds, backfills and
future importers all write evidence. A constraint that lives next to the data
holds for all of them.
