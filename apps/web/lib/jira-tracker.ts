/**
 * Jira Cloud as where a company's tickets go: is the project reachable with
 * these credentials, and open an issue in it.
 *
 * Jira Cloud only — `<site>.atlassian.net`, which the database also insists on
 * (a free-form host would let this server be pointed anywhere). Credentials
 * are an Atlassian account's email and an API token, sent as Basic auth, and
 * stored sealed together as JSON, like a GitHub token.
 *
 * The REST API v2 is used because it takes a description as wiki markup — a
 * string — where v3 wants a document tree; lib/ticket.ts writes the markup.
 */

export interface JiraCredentials {
  readonly email: string;
  readonly token: string;
}

export interface JiraTarget {
  readonly site: string;
  readonly project: string;
}

/** "acme.atlassian.net/PROD" from what an owner is likely to paste. */
export function normaliseJira(siteInput: string, projectInput: string): string | null {
  const site = siteInput
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '');
  const project = projectInput.trim().toUpperCase();
  if (!/^[a-z0-9][a-z0-9-]{0,62}\.atlassian\.net$/.test(site)) return null;
  if (!/^[A-Z][A-Z0-9_]{1,19}$/.test(project)) return null;
  return `${site}/${project}`;
}

export function parseJiraTarget(target: string): JiraTarget {
  const [site, project] = target.split('/');
  return { site: site!, project: project! };
}

/** The sealed form's contents, or null for something that is not ours. */
export function parseJiraCredentials(secret: string): JiraCredentials | null {
  try {
    const value = JSON.parse(secret) as Partial<JiraCredentials>;
    return typeof value.email === 'string' && typeof value.token === 'string' ? { email: value.email, token: value.token } : null;
  } catch {
    return null;
  }
}

function headers(credentials: JiraCredentials): Record<string, string> {
  return {
    authorization: `Basic ${Buffer.from(`${credentials.email}:${credentials.token}`).toString('base64')}`,
    accept: 'application/json',
    'content-type': 'application/json',
  };
}

export type JiraCheck = { ok: true; name: string } | { ok: false; message: string };

export async function checkJiraProject(target: string, credentials: JiraCredentials): Promise<JiraCheck> {
  const { site, project } = parseJiraTarget(target);
  const response = await fetch(`https://${site}/rest/api/2/project/${project}`, { headers: headers(credentials) });
  if (response.status === 401) return { ok: false, message: 'Jira did not accept that email and API token.' };
  if (response.status === 404 || response.status === 403) {
    return { ok: false, message: `That account cannot see project ${project} on ${site}. Check the key, and the account's access.` };
  }
  if (!response.ok) return { ok: false, message: `Jira answered ${response.status}; try again shortly.` };
  const body = (await response.json()) as { name?: string };
  return { ok: true, name: body.name ?? project };
}

/** Task if the project has it, then Story, then whatever it has that is not a sub-task. */
async function issueType(site: string, project: string, credentials: JiraCredentials): Promise<string | null> {
  const response = await fetch(`https://${site}/rest/api/2/issue/createmeta/${project}/issuetypes`, { headers: headers(credentials) });
  if (!response.ok) return 'Task';
  const body = (await response.json()) as { issueTypes?: { name: string; subtask?: boolean }[]; values?: { name: string; subtask?: boolean }[] };
  const types = (body.issueTypes ?? body.values ?? []).filter((type) => !type.subtask).map((type) => type.name);
  return types.find((name) => name === 'Task') ?? types.find((name) => name === 'Story') ?? types[0] ?? null;
}

export type CreatedJiraIssue = { ok: true; key: string; url: string } | { ok: false; status: number; message: string };

export async function createJiraIssue(
  target: string,
  credentials: JiraCredentials,
  issue: { title: string; body: string },
): Promise<CreatedJiraIssue> {
  const { site, project } = parseJiraTarget(target);
  const type = await issueType(site, project, credentials);
  if (!type) return { ok: false, status: 409, message: `Project ${project} has no issue type a ticket can be.` };
  const response = await fetch(`https://${site}/rest/api/2/issue`, {
    method: 'POST',
    headers: headers(credentials),
    body: JSON.stringify({
      fields: { project: { key: project }, summary: issue.title.slice(0, 250), description: issue.body, issuetype: { name: type } },
    }),
  });
  if (!response.ok) {
    const detail = (await response.json().catch(() => ({}))) as { errorMessages?: string[]; errors?: Record<string, string> };
    const said = [...(detail.errorMessages ?? []), ...Object.values(detail.errors ?? {})].join(' ');
    const hint = response.status === 401 ? ' The API token may have been revoked; an owner can reconnect in Settings.' : '';
    return { ok: false, status: response.status, message: `${said || `Jira answered ${response.status}`}.${hint}` };
  }
  const created = (await response.json()) as { key: string };
  return { ok: true, key: created.key, url: `https://${site}/browse/${created.key}` };
}
