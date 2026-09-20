# Build plan

Phases are gated. A phase is done when its gate passes — a demonstrable
condition, not a feeling. If a gate will not pass, that is information about
the design, not a reason to move on.

Full reasoning, architecture diagrams, latency budget and cost model:
https://claude.ai/code/artifact/a7cdd883-3bc5-48f5-84da-a0fe6b21f329

## Phases

| # | Phase | Gate | Status |
|---|---|---|---|
| P0 | Foundation | Two seeded companies. User A cannot reach company B's data via API, direct query, or `retrieve()`. Test green in CI. | Done |
| P1 | Batch intelligence slice | Every displayed signal links to a timestamped quote; clicking scrolls to that segment. | Built; gate not yet witnessed in a browser |
| P2 | Scoring engine | ~40 unit tests over synthetic detector sequences, no LLM in the test path. Score monotonic except on explicit contradiction. | Done — 56 tests |
| P3 | Evaluation harness | A committed precision/recall number for problem detection, feature-request detection and criterion correctness, with the date measured. | Done — numbers in `services/eval/benchmarks/results.md` |
| P4 | Bulk transcript import | 50 transcripts ingest in one run; cost per transcript recorded; failures are per-file. | **Done** — 50 in 78 s, 48 imported, 2 malformed failed alone, $0.015 per transcript |
| P5 | Retrieval and insights | One insight with >= 3 evidence items from >= 2 conversations, each citing customer and timestamp. Cross-tenant test still green. | Built; one insight in production across 4 conversations |
| P6 | Live path, browser first | Measured p50/p95 for utterance -> visible score against the latency budget. | In progress — live scorecard page measures against ADR 0010 |
| P7 | Electron HUD | Overlay over a live Zoom call; scorecard updates; meeting stays visible and clickable; screen-share behaviour matches S1. | Blocked on S1 results |
| P8 | Prepare and Act | An insight moves from approval to a created ticket carrying its evidence citations. No auto-creation anywhere. | Not started |

## MVP

**Decided 2026-09-15: the MVP is post-call — P0 through P5.** Import
transcripts, evidence-backed signals, a post-call scorecard and
cross-conversation insights. The live path and the Electron HUD (P6, P7) are
v2; P8 follows.

P2 is built before P1: it needs no data, no network and no model, so it
proceeds while P1 waits on transcripts.

## Latency budget (P6/P7 contract)

> Superseded by ADR 0010. The figures below were targets written before
> measurement; T1 measured at ~1450 ms against the 700 ms budgeted here, and
> the revised contract is ~2 s utterance to visible score.

| Stage | Budget |
|---|---|
| Speech -> interim transcript | 300 ms |
| Utterance boundary detection | 200 ms |
| Criterion detection (T1) | 700 ms |
| State reconcile + score | 20 ms |
| IPC -> overlay repaint | 80 ms |
| **Utterance -> visible score** | **~1.30 s** (target 1.5 s) |
| Suggestion refresh (T2, async) | <= 3.5 s |

## Spikes

Timeboxed and throwaway. Run alongside P0, not when the relevant phase
arrives — each answers a question whose answer could change the plan.

| # | Box | Question | Status |
|---|---|---|---|
| S1 | 1 day | Does `setContentProtection(true)` exclude the overlay from a shared screen — Zoom desktop, Meet in Chrome, Teams; window vs full-screen share? | Apparatus built (`apps/desktop`), results pending a human in a meeting. Windows only; macOS untested. |
| S2 | 1 day | Which streaming STT hits the 300 ms partial budget, at what real $/min? | Not started |
| S3 | 2 days | Can `claude-haiku-4-5` detect criteria accurately from a 600-token window? How does a local model compare? | **Done** — 84% F1, but 1450 ms against a 700 ms budget, and a local 4B model is 25x slower at 25% F1. Budget revised by ADR 0010. |

## Explicitly not building yet

Billing, the full 25-table schema, LangChain / LlamaIndex / LangGraph,
fine-tuning, Teams, mobile, SSO, multi-language, FastAPI in the request path,
agent frameworks.

## Open decisions

- Real transcripts: **none yet (2026-09-15).** Build P1 against synthetic
  transcripts, labelled as synthetic. Every precision/recall number is
  provisional until real transcripts replace them; P3's gate is not passed on
  synthetic data.
- macOS access for S1/S2? Content protection is a different mechanism there.
- S2 priority: lowest latency or lowest cost?
- Live minutes in pricing — metered, bundled allowance, or higher base. Live
  inference is ~9x post-call cost, so the Starter tier as drafted is negative
  margin. Decide before publishing pricing.
