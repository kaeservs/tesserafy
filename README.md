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

**Phase 0 — Foundation.** No application code yet. See
[docs/engineering/build-plan.md](docs/engineering/build-plan.md) for the phase
sequence and the gate each phase must pass.

## Layout

    apps/web/          Next.js — dashboard, review, insight inbox
    apps/desktop/      Electron — the live HUD (Phase 7)
    packages/scoring/  Pure TypeScript — criterion state machine + score. Zero deps.
    packages/ai/       Provider abstraction, prompts, guarded retrieval
    packages/db/       Generated Supabase types, query helpers
    services/eval/     Python — labelling CLI, evaluation harness
    supabase/          Migrations
    docs/              Product, engineering, ADRs, experiments

## Getting started

    pnpm install
    cp .env.example .env.local     # then fill it in
    pnpm dev

Requires Node 24+, pnpm 12+, Python 3.12+ (for `services/eval`), and Ollama
for local embeddings.

## Non-negotiables

Three invariants that everything else is built around. Breaking any of them is
a defect, not a tradeoff:

- **The model never produces a score.** It produces evidence spans. A pure
  function in `packages/scoring` produces the score.
- **Every retrieval is tenant-scoped.** `company_id` is a required argument,
  not an optional filter. RLS is defence in depth, not the control.
- **No insight without evidence.** If it cannot cite a quote, it does not ship
  to the user.
