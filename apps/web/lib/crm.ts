import type { SupabaseClient } from '@tesserafy/db';
import { engagementLabel } from './company';
import { noteHtml } from './crm-note';
import { companyRecordUrl, findCompanyByDomain, HubSpotRefused, writeNote } from './hubspot';
import { scoreConversation } from './scorecard';
import { sealer, SealKeyMissing } from './sealed';

/**
 * Logging a call to the company's CRM (ADR 0024), as the person who asked:
 * their RLS client reads the call, `crm_for_call` hands back the sealed token
 * only for a call of their own company (and never to a support session), and
 * this server opens it for this one request.
 */

const KEY_ENV = 'CRM_TOKEN_KEY';
const box = sealer(KEY_ENV);

export const CRM_NAME = { hubspot: 'HubSpot' } as const;
export type CrmProvider = keyof typeof CRM_NAME;

export function isCrmProvider(value: unknown): value is CrmProvider {
  return value === 'hubspot';
}

/** Whether this deployment can connect CRMs at all. */
export function crmKeyAvailable(): boolean {
  return box.available();
}

export function sealCrmToken(token: string, companyId: string): string {
  if (!box.available()) throw new SealKeyMissing(KEY_ENV);
  return box.seal(token, companyId);
}

export type CrmOutcome =
  | { readonly status: 'logged'; readonly companyName: string; readonly url: string; readonly updated: boolean }
  | { readonly status: 'not_connected' }
  | { readonly status: 'no_customer' }
  | { readonly status: 'no_record'; readonly domain: string }
  | { readonly status: 'refused' };

const day = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

export async function logCallToCrm(
  db: SupabaseClient,
  conversationId: string,
  callUrl: string,
  doFetch: typeof fetch = fetch,
): Promise<CrmOutcome> {
  const { data: crms, error: crmError } = await db.rpc('crm_for_call', { p_conversation_id: conversationId });
  if (crmError) throw crmError;
  const crm = crms?.[0];
  if (!crm || !isCrmProvider(crm.provider)) return { status: 'not_connected' };
  if (!box.available()) throw new SealKeyMissing(KEY_ENV);
  const token = box.open(crm.token_ciphertext, crm.company_id);
  if (!token) return { status: 'refused' };

  const { data: call } = await db
    .from('conversations')
    .select('id, company_id, title, occurred_at, created_at, engagement_type, criteria_version, account_id')
    .eq('id', conversationId)
    .maybeSingle();
  if (!call) return { status: 'not_connected' };
  const { data: customer } = call.account_id
    ? await db.from('accounts').select('domain').eq('id', call.account_id).maybeSingle()
    : { data: null };
  const domain = customer?.domain?.trim().toLowerCase();
  if (!domain) return { status: 'no_customer' };

  const [scored, { data: actionRows }, { data: logged }] = await Promise.all([
    scoreConversation(db, call),
    db.from('action_items').select('action, owner_side, done').eq('conversation_id', conversationId).order('created_at'),
    db.from('crm_logs').select('external_id').eq('conversation_id', conversationId).eq('provider', crm.provider).maybeSingle(),
  ]);
  const observed = scored.scorecard.criteria.some((criterion) => criterion.status !== 'unobserved');
  const html = noteHtml({
    title: call.title,
    when: day.format(new Date(call.occurred_at ?? call.created_at)),
    scorecard: engagementLabel(call.engagement_type),
    score: observed ? Math.round(scored.scorecard.score) : null,
    criteria: scored.scorecard.criteria.map((criterion) => ({
      label: criterion.label,
      met: criterion.status === 'confirmed',
      quote: criterion.evidence.at(-1)?.span.quote ?? null,
    })),
    actions: (actionRows ?? []).map((row) => ({ action: row.action, ours: row.owner_side === 'ours', done: row.done })),
    url: callUrl,
  });

  try {
    const record = await findCompanyByDomain(token, domain, doFetch);
    if (!record) return { status: 'no_record', domain };
    const noteId = await writeNote(
      token,
      { existingId: logged?.external_id ?? null, html, at: new Date(call.occurred_at ?? call.created_at).toISOString(), companyId: record.id },
      doFetch,
    );
    const { error } = await db.rpc('record_crm_log', {
      p_conversation_id: conversationId,
      p_provider: crm.provider,
      p_external_id: noteId,
      p_crm_company_id: record.id,
      p_crm_company_name: record.name,
    });
    if (error) throw new Error(`Recording the CRM note failed: ${error.message}`);
    return { status: 'logged', companyName: record.name, url: companyRecordUrl(crm.account_ref, record.id), updated: noteId === logged?.external_id };
  } catch (error) {
    if (error instanceof HubSpotRefused && (error.status === 401 || error.status === 403)) {
      await db.rpc('record_crm_error', {
        p_error: error.status === 401 ? 'HubSpot no longer accepts the token.' : 'The token is missing a scope HubSpot asked for.',
      });
      return { status: 'refused' };
    }
    throw error;
  }
}
