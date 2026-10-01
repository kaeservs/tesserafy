# 0019 — Alerts read a digest of counts, with a token, not the service-role key

**Status:** proposed · 2026-10-01

## Context

The alarm is `pnpm health`, run every four hours by a GitHub Action that fails
when something needs a person. Nobody is told about a failed run unless they
open GitHub. On 2026-10-01 the Anthropic account ran out of credit, and every
AI feature was down with no message to anyone. The owner runs a self-hosted
n8n and wants alerts sent to a chat app from there.

An alerting workflow has to read something. What it reads leaves Tesserafy
twice: into n8n, and then into a chat app.

## Options

- **n8n holds the service-role key.** This breaks invariant 3. The key would
  sit in a second system and read every table.
- **An endpoint in the operator console, behind a shared secret.** The
  console would have to read with the service-role key to answer a caller
  who isn't an operator session. Invariant 3 keeps the key to three Auth
  admin calls; operators read through RLS as themselves.
- **One SECURITY DEFINER function, `ops_digest(token)`, callable with the
  public key.** An operator makes the token in the console. Only its sha256
  is stored, as with plan refunds. The function returns counts and states
  only.

## Decision

**The third option.**

- `ops_digest(p_token, p_hours)` returns:
  - failures grouped by kind, source and status, with no message (a failure's
    message, scrubbed or not, can quote a customer);
  - `alarming`, the same judgement as `pnpm health`: `model_rejected`,
    `database` and `billing` groups seen twice or more in the window;
  - `billing`;
  - `new_companies`;
  - what waits on an operator: access requests, deletion requests and
    unfinished provisioning;
  - AI spend in total, for the window and the last 7 days.

  It returns no company names, no people and nothing from a call.
- **The token.** One live token at a time, made on the console's Alerts page
  (`admin_create_ops_token`) and shown once. Making another replaces it, and
  it can be revoked. The console shows its last four characters and when it
  was last used.
- **One judgement.** It now lives in SQL as well as in
  `packages/db/src/health.ts`. A unit test reads the migration and fails if
  the kinds or `ALARM_AT` differ.

## The workflow

Nothing in n8n holds anything but the public key and this token. The workflow:

1. runs on a timer, every 15 minutes;
2. makes an HTTP POST to `<SUPABASE_URL>/rest/v1/rpc/ops_digest`, with
   headers `apikey` and `Authorization: Bearer` set to the public key, and
   body `{"p_token": "...", "p_hours": 1}`;
3. sends a message (Telegram or Slack, the owner's choice) when
   `alarming > 0` or `billing` is true, linking to the console's Failures
   page;
4. once a week, sends a digest of the same counts.

## Consequences

- An outage like 2026-10-01's reaches someone within 15 minutes, not whenever
  someone opens GitHub.
- Anyone holding the token learns operational counts. That's why the digest
  carries nothing else, and why the token is revocable and replaced in one
  click.
- `pnpm health` and the scheduled Action stay as they are: the digest adds a
  messenger, and replaces nothing.
