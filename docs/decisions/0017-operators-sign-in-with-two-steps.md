# 0017 — Operators sign in with two steps, and the database asks

**Status:** proposed · 2026-09-28 · amends invariant 3 (CLAUDE.md)

## Context

The operator console can open a session as any customer, set any company's
plan, close companies and delete accounts. A password alone guarded all of it.
An operator's session can also call every admin function straight through
PostgREST, with no console involved, and read other companies' rows through
the "admins read all" policies.

## Options

- **A second step in the console's login only.** Easy, and a stolen password
  walks around it: the admin functions don't ask the console.
- **A second step required by the database.** Every admin function and admin
  policy already goes through `private.is_platform_admin()`, so requiring the
  second step there covers all of them at once.
- **SSO for operators.** Stronger again, but needs an identity provider the
  company does not have yet.

## Decision

**The database requires it, behind a switch.**

- `private.is_platform_admin()` is false for an operator whose session has not
  passed the second step (JWT `aal` is not `aal2`) once
  `app_settings.operator_mfa_required` is on.
  - Refused: the console, the admin functions called directly, and other
    companies' rows through the web app.
- Operators enrol a TOTP authenticator in the console (`/mfa`). Once enrolled,
  the console asks for the code at every sign-in, whether or not the switch is
  on.
- The switch lives on the console's Security page. `admin_set_operator_mfa`:
  - refuses unless the caller's own session is `aal2`, in either direction, so
    a stolen password cannot turn it off first;
  - refuses to turn it on while any operator has no verified authenticator, so
    nobody is locked out by a colleague.
- Changes to the switch are logged in `app_settings_events` and shown in the
  console's Activity.

## Consequences

- Nothing changes on merge. It takes effect when an operator switches it on.
- A lost phone means removing that operator's factor in the Supabase dashboard
  (Authentication → the user) so they can enrol again. There are no recovery
  codes yet.
- `pnpm qa` signs in without a second factor. Once the switch is on, it checks
  that the admin functions refuse that session instead of answering it.
- Operator scripts that act as the operator through PostgREST need an `aal2`
  session once it's on. The service-role scripts (`pnpm support` and the like)
  are unaffected.
