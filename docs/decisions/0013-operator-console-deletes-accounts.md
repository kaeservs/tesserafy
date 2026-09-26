# 0013 — The operator console deletes accounts

**Status:** proposed · 2026-09-27 · amends invariant 3 (CLAUDE.md), after ADR 0012

## Context

Nothing could delete a login account. Removing someone from a team, closing a
company and erasing a meeting all leave the account itself, with its address
and password, in Auth. That is right for those actions, since a person removed
from one team may be added to another, but it leaves two things with no answer:

- **A person who asks to be forgotten.** Their calls belong to their company
  and are erased by the company's own means; their account is theirs, and
  only deleting it removes their address.
- **Accounts nobody uses.** Today that means the synthetic accounts the
  end-to-end checks leave behind. They show up in every count of people.

Deleting an account is an Auth admin call. Like minting a session and creating
an account, no signed-in user can make it for somebody else, and it needs the
service-role key.

It was also impossible for a second reason. Several audit records referred to
accounts through a foreign key with no delete rule: the support-access log,
the operator-onboarding log, who decided on an insight and who exported its
ticket. Auth's delete fails on any of them, and the support-access log is
exactly what must not be deleted to make room: it is "the record a customer
may one day need against us".

## Decision

The console may use the key for a third Auth admin call: **deleting an account
an operator has already recorded deleting.** It has the same shape as ADR 0012:

1. `open_account_deletion` runs as the operator. It checks they are a platform
   admin and that the account exists, is in no company, is not an operator's
   or their own, and has no support session open on it. It requires a reason.
   It writes an `account_deletions` row before anything is deleted.
2. `deleteAccountFor` uses the key to hard-delete the account in Auth. It does
   not touch a table.
3. `complete_account_deletion` runs as the operator who opened the row, and
   closes it only once the account is really gone from `auth.users`.

**Only accounts in no company.** Somebody in a company leaves it first, either
removed by the owner or because the company is closed. Deleting an account
therefore never reaches into a live company's team, and the rules about teams
stay in one place.

**Audit records keep the id and lose the foreign key.** The support-access log,
the onboarding log's operator, and an insight's decider and ticket creator keep
the account's id, so the record still says who did what to whom. The foreign
key is dropped, because a foreign key to an account is what stops Auth deleting
it. Once the account is gone the id resolves to nothing: no address, no name,
no password. Every other reference to an account already cascades (memberships,
operator rows) or is set to null (who added a call, who confirmed consent, and
the like).

**The deletion record keeps a SHA-256 of the lower-cased address, not the
address.** "Was this address erased, and when?" can then be answered by someone
who already knows the address, and not by anyone reading the table.

A pgTAP guard checks that no foreign key outside Auth can block a deletion, so
a later table that forgets fails CI, not a deletion in production.

## Consequences

- Invariant 3 names three uses of the key, all Auth admin calls, each preceded
  by a record the operator writes as themselves.
- `open_support_access` checks for itself that the account exists, since the
  foreign key that used to refuse a nonexistent one is gone. Every other writer
  of these columns takes the id from the session, which exists by construction.
- A failure between steps 1 and 3 leaves an open row, shown as "did not
  finish". Nothing about the account is recorded beyond the fingerprint, so
  the operator retries it from the People page.
- The operator writes the reason in free text and could type the address into
  it. The console asks them not to; nothing can prevent it.
- The console's access history shows "a deleted account" where a deleted
  person's address used to be.

## Alternatives

- **Refuse to delete anyone an audit record mentions.** Keeps every foreign key,
  and makes erasure impossible for exactly the people most likely to ask:
  anyone staff have ever supported.
- **Set the audit references to null.** The record would survive but no longer
  say whose account was opened: "someone opened an account" is not an audit
  trail.
- **Keep the address in the audit record.** Then the record is what stops the
  person being forgotten.
- **Auth's soft delete.** It keeps the row with the address obfuscated. That
  is not what someone asking to be forgotten asked for, and it leaves the
  foreign-key problem where it was.
