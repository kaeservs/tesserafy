/**
 * Whether the console offers to delete an account.
 *
 * The database decides (`open_account_deletion`) and says why when it
 * refuses; this only keeps the console from offering what it would refuse:
 * an account still in a company, an operator's, one a support session is open
 * on, or the operator's own.
 */
export function deletable(
  user: { user_id: string; company_id: string | null; is_admin: boolean; open_support: boolean },
  self: string,
): boolean {
  return !user.company_id && !user.is_admin && !user.open_support && user.user_id !== self;
}
