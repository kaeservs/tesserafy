/**
 * Linear as where a company's tickets go: is the team reachable with this API
 * key, and open an issue in it.
 *
 * One host, api.linear.app, so the stored target is only the team's key (ENG)
 * and there is nothing to point elsewhere. A personal API key is sent as the
 * Authorization header, as Linear asks. Descriptions are markdown, so the
 * ticket body GitHub gets reads the same here.
 */

const API = 'https://api.linear.app/graphql';

/** "ENG" from what an owner is likely to type. */
export function normaliseLinearTeam(input: string): string | null {
  const key = input.trim().toUpperCase();
  return /^[A-Z][A-Z0-9]{0,9}$/.test(key) ? key : null;
}

async function graphql<T>(apiKey: string, query: string, variables: Record<string, unknown>): Promise<{ status: number; data: T | null; error: string | null }> {
  const response = await fetch(API, {
    method: 'POST',
    headers: { authorization: apiKey, 'content-type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  const body = (await response.json().catch(() => ({}))) as { data?: T; errors?: { message: string }[] };
  return { status: response.status, data: body.data ?? null, error: body.errors?.[0]?.message ?? null };
}

async function teamId(apiKey: string, key: string): Promise<{ ok: true; id: string; name: string } | { ok: false; status: number; message: string }> {
  const answer = await graphql<{ teams: { nodes: { id: string; name: string }[] } }>(
    apiKey,
    'query Team($key: String!) { teams(filter: { key: { eq: $key } }) { nodes { id name } } }',
    { key },
  );
  if (answer.status === 401 || /authenticat/i.test(answer.error ?? '')) {
    return { ok: false, status: 401, message: 'Linear did not accept that API key.' };
  }
  if (!answer.data) return { ok: false, status: answer.status, message: answer.error ?? `Linear answered ${answer.status}; try again shortly.` };
  const team = answer.data.teams.nodes[0];
  if (!team) return { ok: false, status: 404, message: `That key cannot see a team called ${key}. Team keys are the prefix of issue ids, like ENG in ENG-12.` };
  return { ok: true, id: team.id, name: team.name };
}

export type LinearCheck = { ok: true; name: string } | { ok: false; message: string };

export async function checkLinearTeam(key: string, apiKey: string): Promise<LinearCheck> {
  const team = await teamId(apiKey, key);
  return team.ok ? { ok: true, name: team.name } : { ok: false, message: team.message };
}

export type CreatedLinearIssue = { ok: true; key: string; url: string } | { ok: false; status: number; message: string };

export async function createLinearIssue(
  key: string,
  apiKey: string,
  issue: { title: string; body: string },
): Promise<CreatedLinearIssue> {
  const team = await teamId(apiKey, key);
  if (!team.ok) return team;
  const answer = await graphql<{ issueCreate: { success: boolean; issue: { identifier: string; url: string } | null } }>(
    apiKey,
    'mutation Create($input: IssueCreateInput!) { issueCreate(input: $input) { success issue { identifier url } } }',
    { input: { teamId: team.id, title: issue.title.slice(0, 250), description: issue.body } },
  );
  const created = answer.data?.issueCreate;
  if (!created?.success || !created.issue) {
    return { ok: false, status: answer.status, message: answer.error ?? 'Linear did not create the issue.' };
  }
  return { ok: true, key: created.issue.identifier, url: created.issue.url };
}
