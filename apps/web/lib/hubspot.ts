/**
 * A company's HubSpot (ADR 0024): the few calls that log a call there.
 *
 * With the company's own token, from a private app its owner created in
 * HubSpot, opened by this server for one request. What is read is the least
 * that puts a note in the right place: the customer's company record, found
 * by the domain the call's customer has in Tesserafy. What is written is one
 * note a call, on that record, updated when the call is logged again.
 */

const API = 'https://api.hubapi.com';

/** HubSpot's own association types: a note on a company record. */
const NOTE_TO_COMPANY = 190;

export class HubSpotRefused extends Error {
  override readonly name = 'HubSpotRefused';
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function call<T>(token: string, path: string, init: RequestInit, doFetch: typeof fetch): Promise<T> {
  const response = await doFetch(`${API}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
  });
  const body = (await response.json().catch(() => ({}))) as T & { message?: string; category?: string };
  if (!response.ok) {
    throw new HubSpotRefused(response.status, `HubSpot refused: ${response.status} ${body.category ?? ''} ${body.message ?? ''}`.trim());
  }
  return body;
}

export type HubSpotCheck = { ok: true; portalId: string } | { ok: false; message: string };

/**
 * Before a token is stored: which HubSpot account it is, and whether it can
 * read companies — refused now, not on the first call someone logs.
 */
export async function checkHubSpot(token: string, doFetch: typeof fetch = fetch): Promise<HubSpotCheck> {
  try {
    const account = await call<{ portalId?: number }>(token, '/account-info/v3/details', { method: 'GET' }, doFetch);
    if (typeof account.portalId !== 'number') return { ok: false, message: 'HubSpot did not say which account this token is for.' };
    await call(token, '/crm/v3/objects/companies?limit=1', { method: 'GET' }, doFetch);
    return { ok: true, portalId: String(account.portalId) };
  } catch (error) {
    if (error instanceof HubSpotRefused) {
      if (error.status === 401) return { ok: false, message: 'HubSpot did not accept that token. Paste the private app’s access token.' };
      if (error.status === 403) {
        return { ok: false, message: 'That token cannot read companies. Give the private app the scopes listed below, then paste its token again.' };
      }
    }
    return { ok: false, message: 'HubSpot could not be reached. Try again in a minute.' };
  }
}

/** The customer's company record, by its domain; null when HubSpot has none. */
export async function findCompanyByDomain(
  token: string,
  domain: string,
  doFetch: typeof fetch = fetch,
): Promise<{ id: string; name: string } | null> {
  const found = await call<{ results?: { id: string; properties?: { name?: string | null } }[] }>(
    token,
    '/crm/v3/objects/companies/search',
    {
      method: 'POST',
      body: JSON.stringify({
        filterGroups: [{ filters: [{ propertyName: 'domain', operator: 'EQ', value: domain }] }],
        properties: ['name', 'domain'],
        limit: 1,
      }),
    },
    doFetch,
  );
  const first = found.results?.[0];
  return first ? { id: first.id, name: first.properties?.name ?? domain } : null;
}

/**
 * The call's note: rewritten when it exists, made on the company record when
 * it does not — or when someone deleted it in HubSpot since.
 */
export async function writeNote(
  token: string,
  note: { existingId: string | null; html: string; at: string; companyId: string },
  doFetch: typeof fetch = fetch,
): Promise<string> {
  if (note.existingId) {
    try {
      await call(token, `/crm/v3/objects/notes/${note.existingId}`, {
        method: 'PATCH',
        body: JSON.stringify({ properties: { hs_note_body: note.html, hs_timestamp: note.at } }),
      }, doFetch);
      return note.existingId;
    } catch (error) {
      if (!(error instanceof HubSpotRefused) || error.status !== 404) throw error;
    }
  }
  const made = await call<{ id?: string }>(
    token,
    '/crm/v3/objects/notes',
    {
      method: 'POST',
      body: JSON.stringify({
        properties: { hs_note_body: note.html, hs_timestamp: note.at },
        associations: [
          { to: { id: note.companyId }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: NOTE_TO_COMPANY }] },
        ],
      }),
    },
    doFetch,
  );
  if (!made.id) throw new Error('HubSpot made the note but did not say its id');
  return made.id;
}

/** The company record in HubSpot, for a person to open. */
export function companyRecordUrl(portalId: string, companyId: string): string {
  return `https://app.hubspot.com/contacts/${encodeURIComponent(portalId)}/record/0-2/${encodeURIComponent(companyId)}`;
}
