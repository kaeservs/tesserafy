/**
 * What the product says while someone from Tesserafy is inside an account.
 *
 * A support session is an ordinary session — the product cannot tell the
 * operator's tab from the customer's — so the banner is not keyed on who is
 * looking. It is keyed on the account: if there is an open `support_access`
 * row for it, everyone signed in to it sees the banner. That is the right
 * answer twice over. The customer learns that their account is open, which
 * the access record was always meant to let them learn. And the operator is
 * reminded, on every page, that they are not in their own account and that
 * whatever they do will be attributed to somebody else.
 *
 * Pure, so the wording and the arithmetic can be tested without a database.
 */

export interface OpenAccess {
  readonly reason: string;
  readonly expires_at: string;
}

export interface Banner {
  readonly headline: string;
  readonly detail: string;
}

/**
 * The banner for the session that ends last, or none.
 *
 * Several open rows is possible — two operators on one ticket — and the one
 * that matters to the reader is the one that keeps the account open longest.
 */
export function supportBanner(rows: readonly OpenAccess[], now: Date = new Date()): Banner | null {
  const live = rows.filter((row) => new Date(row.expires_at).getTime() > now.getTime());
  if (live.length === 0) return null;

  const last = live.reduce((a, b) => (new Date(a.expires_at) > new Date(b.expires_at) ? a : b));
  const minutes = Math.max(1, Math.ceil((new Date(last.expires_at).getTime() - now.getTime()) / 60_000));
  const remaining = minutes >= 60 ? `${Math.round(minutes / 60)} h` : `${minutes} min`;

  return {
    headline: 'Tesserafy support has access to this account',
    detail:
      `Opened for: ${last.reason}. Access ends in ${remaining}.` +
      (live.length > 1 ? ` ${live.length} support sessions are open.` : ''),
  };
}
