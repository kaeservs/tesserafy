# 0005 — pgvector installed in the `extensions` schema

**Status:** accepted · 2026-09-11

## Context

Embeddings need pgvector. Supabase ships it as an available extension
(`vector` 0.8.2) but it is not enabled by default.

The first migration ran `create extension if not exists vector with schema
extensions;`. The extension landed in `public` regardless — the platform
appears to override the clause. An extension in `public` trips Supabase's
"extension installed in public schema" security advisory, and moving it later,
once columns already use the `vector` type, is disruptive.

## Decision

Relocate it while the database is empty:

    alter extension vector set schema extensions;

pgvector now sits in `extensions` alongside `pgcrypto` and `uuid-ossp`.

Migrations schema-qualify the type as `extensions.vector(768)` rather than
relying on the search path.

## Consequences

- The security advisory stays clean.
- `extensions` **is** on the database search path, so a bare `vector(768)` will
  in fact resolve. Migrations qualify it anyway, because role-level search
  paths differ from the database default and a silent resolution failure during
  a migration is unpleasant to debug.
- 768 dimensions is set by `nomic-embed-text`. Changing the embedding model
  means a new column and a re-index, which is why `signal_embeddings` is a
  separate table from `signals`.

## Alternatives considered

- **Leave it in `public`.** Works fine; many Supabase projects do. Rejected
  because the empty-database moment is the only free opportunity to fix it.
- **A dedicated `vec` schema.** No benefit over the `extensions` schema that
  Supabase already uses by convention.
