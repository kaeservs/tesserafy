# 0001 — pnpm monorepo with a dependency-free scoring package

**Status:** accepted · 2026-09-12

## Context

Two applications — a Next.js web app and an Electron desktop overlay — need to
share the scoring engine, the AI provider abstraction and the database types.
The scoring engine in particular must behave identically in both, because a
score shown live in the HUD and the same score shown afterwards in the
dashboard must agree exactly.

Separate repositories would mean publishing and versioning internal packages
before there is any reason to. A single application with shared folders would
not survive the Electron app arriving in Phase 7.

## Decision

One repository, pnpm workspaces, with `apps/*` and `packages/*`.

`packages/scoring` carries **zero runtime dependencies**. It is pure
TypeScript: criterion state machine in, score out.

Hoisting is disabled in `.npmrc`, so a workspace package must declare anything
it imports rather than inheriting it from a sibling.

## Consequences

- The scoring engine tests in milliseconds with no network and no API key,
  which makes the ~40 tests of Phase 2's gate cheap to run on every commit.
- Both surfaces import the same compiled logic, so live and post-call scores
  cannot drift.
- It is also the most legible artifact in the codebase for anyone assessing
  engineering ability — a deterministic state machine rather than API plumbing.
- Cost: slightly more ceremony up front, and Next.js needs
  `transpilePackages` configured for the workspace packages.

## Alternatives considered

- **Single Next.js app, extract later.** Cheapest now, but the extraction lands
  exactly when Phase 7 is already the hardest phase.
- **npm workspaces.** Works, and npm is already installed. pnpm's stricter
  linking is what makes the no-hoisting rule enforceable.
- **Turborepo / Nx.** Real caching value at a scale this project is nowhere
  near. Revisit if CI time becomes a complaint.
