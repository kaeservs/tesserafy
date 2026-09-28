import { createIssue } from './github-tracker';
import { createJiraIssue, parseJiraCredentials } from './jira-tracker';
import { createLinearIssue } from './linear-tracker';
import { ticketBody, ticketBodyJira, ticketTitle, type TicketInput } from './ticket';

/**
 * Where a company's tickets go, whichever tracker it is (ADR 0015): one call
 * for the ticket route, so it stays about approval, evidence and idempotence
 * and not about three APIs.
 *
 * `secret` is the opened token: a GitHub or Linear token as it was pasted, or,
 * for Jira, the email and API token as JSON.
 */

export type Provider = 'github' | 'jira' | 'linear';

export const PROVIDER_NAME: Record<Provider, string> = { github: 'GitHub', jira: 'Jira', linear: 'Linear' };

export function isProvider(value: string): value is Provider {
  return value === 'github' || value === 'jira' || value === 'linear';
}

export type Raised = { ok: true; externalId: string; url: string } | { ok: false; status: number; message: string };

export async function raiseTicket(provider: Provider, target: string, secret: string, input: TicketInput): Promise<Raised> {
  const title = ticketTitle(input);
  if (provider === 'github') {
    const created = await createIssue(target, secret, { title, body: ticketBody(input) });
    return created.ok ? { ok: true, externalId: String(created.number), url: created.url } : created;
  }
  if (provider === 'jira') {
    const credentials = parseJiraCredentials(secret);
    if (!credentials) return { ok: false, status: 409, message: 'The stored Jira credentials could not be read; an owner can reconnect in Settings.' };
    const created = await createJiraIssue(target, credentials, { title, body: ticketBodyJira(input) });
    return created.ok ? { ok: true, externalId: created.key, url: created.url } : created;
  }
  const created = await createLinearIssue(target, secret, { title, body: ticketBody(input) });
  return created.ok ? { ok: true, externalId: created.key, url: created.url } : created;
}
