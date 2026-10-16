# Tesserafy

**Turn every conversation into product intelligence.**

An AI conversation intelligence platform. It helps you prepare for a
conversation, assists you live while it happens, analyses what was said
afterwards, finds patterns across many conversations, and turns validated
insights into product decisions.

    PREPARE  ->  PERFORM  ->  LEARN  ->  ACT

The core loop the product exists to serve:

    Conversation -> Evidence -> Intelligence -> Decision -> Action

## What makes it different

Not transcription, not meeting notes. Two things carry the product:

1. **A live engagement scorecard inside a transparent desktop overlay** that
   updates during the conversation and can explain every point it awards.
2. **Cross-conversation intelligence** — the same customer problem surfacing
   in eleven calls becomes one evidence-backed insight, not eleven summaries.

Every claim the system makes is traceable to a quoted span with a timestamp.

## Status

Built and in production: the web app (dashboard), the Electron overlay
(Windows and Mac installers from GitHub Releases) and the operator console.
What is live, what waits on a key or an account, and what comes next is in
[HANDOFF.md](HANDOFF.md); the architecture and its rules are in
[CLAUDE.md](CLAUDE.md), and every lasting decision is an ADR in
[docs/decisions](docs/decisions/README.md).
[docs/engineering/build-plan.md](docs/engineering/build-plan.md) is the
original phase plan, kept as history.

## Layout

    apps/web/          Next.js — the dashboard, and every API the overlay calls
    apps/desktop/      Electron — the overlay that sits over a live call
    apps/admin/        Next.js — the operator console, the one holder of the service-role key
    packages/scoring/  Pure TypeScript — criterion state machine + score. Zero deps.
    packages/ai/       Model tiers, the Ask agent, guarded retrieval, failure and usage records
    packages/ingest/   Transcript parsing, chunking and redaction (T0)
    packages/db/       Generated Supabase types, query helpers
    services/eval/     Python — labelling CLI, evaluation harness
    supabase/          Migrations, pgTAP tests, the embedding edge function
    docs/              Product, engineering, ADRs, experiments

## Getting started

    pnpm install
    cp .env.example .env     # operator scripts read it; pnpm env:check says what is missing
    pnpm dev                 # the web app
    pnpm test                # every workspace, unit only, no network

Requires Node 24+, pnpm 12+, and Python 3.12+ for `services/eval`. Embeddings
run inside Supabase (gte-small, `supabase/functions/embed`), so nothing runs
locally for them. `pnpm exec supabase start` (Docker) gives a local stack for
the pgTAP and integration tests. Every command is listed in CLAUDE.md.

## Non-negotiables

Three invariants that everything else is built around. Breaking any of them is
a defect, not a tradeoff:

- **The model never produces a score.** It produces evidence spans. A pure
  function in `packages/scoring` produces the score.
- **Every retrieval is tenant-scoped.** `company_id` is a required argument,
  not an optional filter. RLS is defence in depth, not the control.
- **No insight without evidence.** If it cannot cite a quote, it does not ship
  to the user.
