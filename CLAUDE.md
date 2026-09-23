# Tesserafy — working notes for Claude Code

## What this is

An AI conversation intelligence platform: conversations become evidence-backed
product insights. Two surfaces — a Next.js web app and an Electron desktop HUD
that overlays live meetings with a real-time engagement scorecard.

This project is also a deliberate AI-engineering apprenticeship. For decisions
that are architecturally meaningful, explain the problem, the options, the
recommendation and the tradeoff before implementing. Trivial syntax needs no
explanation.

## Architectural invariants

Do not break these without an ADR that supersedes the existing one.

1. **The model never produces a score.** Detectors return evidence spans with
   confidences. `packages/scoring` turns those into criterion states and a
   score via a pure function. A number that came straight from an LLM is a bug.
2. **Criterion state is latching.** `unobserved -> candidate -> confirmed`.
   Absence of evidence never demotes a confirmed criterion; only an explicit
   contradiction detector can, and that is recorded as an event. This is what
   stops the live score flickering.
3. **Every retrieval is tenant-scoped.** Exactly one `retrieve()` in
   `packages/ai` may construct a vector query, and `companyId` is its required
   first argument. The AI pipeline runs with a service-role key that bypasses
   RLS, so this function — not RLS — is the real control. Its cross-tenant test
   must stay green.
4. **No insight without evidence.** Every signal, criterion state and insight
   links to a quoted span with a timestamp.
5. **`packages/scoring` has zero runtime dependencies.** It is imported by both
   the web app and the Electron overlay and must test without a network.

## Model routing

| Tier | Job | Model |
|---|---|---|
| T0 | Chunking, endpointing, redaction | none — pure TS |
| T1 | Criterion detectors (<= 700 ms) | `claude-haiku-4-5` |
| T2 | Live suggestions (<= 3.5 s) | `claude-sonnet-5` |
| T3 | Post-call extraction and synthesis | `claude-opus-5` |
| — | Embeddings | `nomic-embed-text` via Ollama, 768-dim |

Live calls put the frozen prefix (system + criteria definitions + context pack)
before the cache breakpoint and the rolling transcript window after it. Check
`usage.cache_read_input_tokens` is non-zero — a timestamp leaking into the
prefix silently kills the cache and the cost model with it. Measured caveat:
with only a system prompt and five criteria the prefix is below Haiku's
minimum cacheable size and the cache never engages at all (spike S3).

T1 runs server-side, not from the client: measurement put the network cost of
calling from a laptop at ~840 ms of a budget the model alone already exceeds
(ADR 0010).

Redaction is T0 and runs before anything is stored: email addresses, phone
numbers and account-length digit runs are masked in `packages/ingest`, so they
never reach segments, embeddings, prompts, ticket bodies or the search index.
It does not remove names and is not anonymisation. Money and durations are
protected explicitly — masking a quantified pain deletes the finding.

T1 runs at `temperature: 0`; T2 and T3 send no temperature at all, because
`claude-sonnet-5` and `claude-opus-5` deprecate the parameter and reject a
request carrying it. Pinning it everywhere on the strength of a T1 measurement
took `/api/suggest`, extraction and synthesis down at once, and only a smoke
check found it. Nothing set one until it was measured:
eight runs over a single identical window produced five distinct results and
three different sets of criteria, one of them empty, and the same three
conversations scored 45 and 18 on consecutive trials. Extraction against a
fixed schema has nothing to gain from sampling. Overridable per call so a
spike can vary it deliberately.

It reduces variance rather than removing it, and that was measured on T1
only. Four repeats of the criterion eval scored 81/81/81/79, with the movement
landing entirely on the one criterion nearest a judgement call. Quote a range,
not a figure, and treat two or three points between single runs as nothing.

Log `response.usage` on every API call. Cost telemetry added later cannot be
backfilled.

A failure that only reaches the caller has not been reported. Every catch that
answers a request records through `recordFailure` in `packages/ai`, which
classifies it — a request we built wrong is not the same event as an
overloaded model — scrubs credentials and customer identifiers out of the
message, and writes a row. `pnpm health` reads those rows and exits non-zero
when something needs a person; a scheduled GitHub Action runs it every four
hours, which is the alarm. Errors are deliberately not sent to a tracking
vendor: an upstream error quotes the request back, and here the request is
meeting content.

## Commands

    pnpm install
    pnpm dev          # web app
    pnpm test         # all workspaces, unit only, no network
    pnpm typecheck
    pnpm guard:retrieval             # ADR 0004 grep guard
    pnpm ingest <file.vtt> --company <uuid>   # transcript -> segments -> signals
    pnpm ingest <file.vtt> --dry-run         # parse and chunk only, writes nothing
    pnpm score --company <uuid>              # T1 over stored segments -> criterion_events
    pnpm score --company <uuid> --dry-run    # print the detector call count, send nothing
    pnpm process --conversation <uuid>       # embed stored segments -> T3 signals
    pnpm process --conversation <uuid> --dry-run  # say what it would cost, spend nothing
    pnpm criteria --list                     # criteria sets that exist
    pnpm criteria --add <file.json>          # publish a new engagement type or version
    pnpm criteria --try <file.json> --company <uuid> [--sample 5]  # try a set, write nothing
    pnpm erase --conversation <uuid>         # erase a meeting and everything derived from it
    pnpm erase --company <uuid> --retention 90   # set a retention period
    pnpm erase --purge                       # erase everything past its retention
    pnpm smoke:tiers                 # one real call per tier: does the API still accept it
    pnpm health [--hours 24]         # what has failed in production, and does it need a person
    pnpm exec supabase start         # local stack (needs Docker)
    pnpm exec supabase test db       # pgTAP tenant isolation
    pnpm test:integration            # RLS + retrieve() cross-tenant, local stack only

## Conventions

- TypeScript everywhere in `apps/` and `packages/`. Python only in
  `services/eval`.
- Database changes go through `supabase/migrations/` — never ad-hoc SQL against
  the remote project.
- Schema-qualify the vector type as `extensions.vector(768)` in migrations.
  pgvector lives in the `extensions` schema, not `public`.
- Criteria definitions are seed data, not code. A new engagement type is a row,
  written with `pnpm criteria --add` — an operator with the service role, never
  a browser. A published version is immutable, because conversations pin the
  version they were scored against; a change is a new version.

## MCP routing

Use `n8n-selfhosted` for n8n, `claude.ai Supabase-tesserafy` for Supabase and
`github` (project `.mcp.json`, repo `kaeservs/tesserafy`) for GitHub.
The `claude.ai n8n` connector and the project-scoped `supabase` server point at
different infrastructure — do not use them.

## Out of scope

Paragon / AI Paragon files in the user's home directory belong to a different
project. Never read them, cite them, or treat them as prior art here.
