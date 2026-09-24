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
| P1 | Batch intelligence slice | Every displayed signal links to a timestamped quote; clicking scrolls to that segment. | **Done** — witnessed by `pnpm e2e` in Chromium: 15 quotes across 5 conversations, each verbatim in the segment it points at |
| P2 | Scoring engine | ~40 unit tests over synthetic detector sequences, no LLM in the test path. Score monotonic except on explicit contradiction. | Done — 56 tests |
| P3 | Evaluation harness | A committed precision/recall number for problem detection, feature-request detection and criterion correctness, with the date measured. | Done — numbers in `services/eval/benchmarks/results.md` |
| P4 | Bulk transcript import | 50 transcripts ingest in one run; cost per transcript recorded; failures are per-file. | **Done** — 50 in 78 s, 48 imported, 2 malformed failed alone, $0.015 per transcript |
| P5 | Retrieval and insights | One insight with >= 3 evidence items from >= 2 conversations, each citing customer and timestamp. Cross-tenant test still green. | **Done** — one insight in production, 4 signals across 4 conversations; page shows every citation |
| P6 | Live path, browser first | Measured p50/p95 for utterance -> visible score against the latency budget. | Built — replay and microphone paths both measure against ADR 0010; real STT awaits S2 |
| P7 | Electron HUD | Overlay over a live Zoom call; scorecard updates; meeting stays visible and clickable; screen-share behaviour matches S1. | Built — overlay listens, detects and scores; screen-share behaviour awaits S1 |
| P8 | Prepare and Act | An insight moves from approval to a created ticket carrying its evidence citations. No auto-creation anywhere. | Built and applied; needs GITHUB_TOKEN and GITHUB_TICKET_REPO to raise a real ticket |
| P10 | Transcript import | A signed-in member can add a transcript without a terminal; it parses through the same chunker as `pnpm ingest`. | **Done** — `/conversations/new`; an upload scores itself (T1) within seconds, as the uploader |
| P9 | Dashboard and history | A past meeting shows a scorecard derived from stored evidence; criteria coverage across every meeting. No score stored anywhere. | Built — `criterion_events` + `/dashboard`; needs the migration applied and `pnpm score` run |

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
| S2 | 1 day | Which streaming STT hits the 300 ms partial budget, at what real $/min? | Not started — needs vendor accounts. Browser speech recognition stands in meanwhile, and sends audio to the browser vendor, which no customer call may do. |
| S3 | 2 days | Can `claude-haiku-4-5` detect criteria accurately from a 600-token window? How does a local model compare? | **Done** — 84% F1, but 1450 ms against a 700 ms budget, and a local 4B model is 25x slower at 25% F1. Budget revised by ADR 0010. |

## Explicitly not building yet

Billing, the full 25-table schema, LangChain / LlamaIndex / LangGraph,
fine-tuning, Teams, mobile, SSO, multi-language, FastAPI in the request path,
agent frameworks.

## What is left

The MVP is P0 through P5, and all six gates pass. P1 was the last, and it was
the one gate no unit test could close: every word of it — a link that
resolves, a scroll that happens, a highlight on the right phrase — is about a
rendered page.

It is closed by `pnpm e2e`, which drives Chromium against a real deployment
holding real data. The assertion that earns its keep is not the scrolling but
the string comparison: every quote shown under a signal must appear, character
for character, inside the segment it links to. A detector that paraphrases
leaves every link working and every highlight landing while the product
quietly improves on what a customer said, and that is invisible to any test
that does not compare the two strings.

A transcript can now be imported from the web app, which was the gap between
"the MVP works" and "somebody other than an operator can use it". It lands
with segments and no embeddings; `pnpm score` and `pnpm process` finish it,
and the conversation says which of them it is waiting for.

What is left cannot be done from a keyboard alone:

- **S1** — run the overlay against Zoom, Meet and Teams, including the
  protection-off control step. P7's gate depends on the answer.
- **S2** — choose a streaming transcriber that can run under our own terms.
  Until then the live path uses the browser's, which sends audio to the
  browser vendor.
- **ADR 0010** — accept, amend or reject the revised ~2 s budget. It changes a
  product promise, so it is not a technical call.
- **P8** — `GITHUB_TOKEN` and `GITHUB_TICKET_REPO` in Vercel, then approve an
  insight and raise a ticket.
- **QA** — `pnpm qa` covers what a machine can judge; the rest is in
  `qa-checklist.md`.
- **Sign-in** — works in any browser now, via the implicit flow, and a
  password form exists for testing. Custom SMTP plus a token_hash link is
  still the better endpoint for invited customers: it would keep tokens out
  of browser history.
- **Live capture is done, on both surfaces.** The web microphone and the
  Electron overlay each create a conversation when recording starts, append
  each utterance, and save the evidence behind every score — through
  SECURITY DEFINER functions that derive quote offsets from the stored
  segment, so a caller may assert what was said and nothing else. The
  overlay's path is the same one through a bearer token rather than cookies,
  verified against production.

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
