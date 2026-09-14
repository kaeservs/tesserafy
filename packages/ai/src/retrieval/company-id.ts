declare const companyIdBrand: unique symbol;

/**
 * A company UUID that has been validated as one.
 *
 * Branded so that a conversation id, a user id or any other plain string
 * cannot be passed where a tenant is expected — swapping two uuid arguments
 * becomes a type error instead of a silent wrong-tenant query.
 */
export type CompanyId = string & { readonly [companyIdBrand]: true };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isCompanyId(value: unknown): value is CompanyId {
  return typeof value === 'string' && UUID.test(value);
}

/** Validates and brands. Call at the edge, where a company id enters the system. */
export function toCompanyId(value: string): CompanyId {
  if (!isCompanyId(value)) {
    throw new TypeError(`Not a valid company id: ${JSON.stringify(value)}`);
  }
  return value;
}
