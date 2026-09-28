/**
 * The two things a company's GitHub tracker is asked: is it reachable with this
 * token, and open an issue in it.
 *
 * The check runs before a token is stored, so an owner who pasted the wrong
 * repository or a token for another account hears it then, not on the first
 * approved insight. GitHub does not say what a fine-grained token may *do* in
 * a repository without trying, so the check is that the repository can be
 * read and has issues switched on; the first ticket proves the rest, and the
 * page asks for a token scoped to that one repository with Issues read and
 * write and nothing else.
 */

const API = 'https://api.github.com';

function headers(token: string): Record<string, string> {
  return {
    authorization: `Bearer ${token}`,
    accept: 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
    'content-type': 'application/json',
  };
}

/**
 * "owner/repo" from what an owner is likely to paste: the bare name, or the
 * repository's address, with or without a trailing slash or `.git`.
 */
export function normaliseRepository(input: string): string | null {
  const trimmed = input.trim().replace(/\.git$/, '').replace(/\/+$/, '');
  const match = /^(?:https?:\/\/github\.com\/)?([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/.exec(trimmed);
  return match ? `${match[1]}/${match[2]}` : null;
}

export type RepositoryCheck = { ok: true; fullName: string } | { ok: false; message: string };

export async function checkRepository(repository: string, token: string): Promise<RepositoryCheck> {
  const response = await fetch(`${API}/repos/${repository}`, { headers: headers(token) });
  if (response.status === 401) return { ok: false, message: 'GitHub did not accept that token.' };
  if (response.status === 404 || response.status === 403) {
    return {
      ok: false,
      message: `That token cannot see ${repository}. Check the name, and that the token was given access to it.`,
    };
  }
  if (!response.ok) return { ok: false, message: `GitHub answered ${response.status}; try again shortly.` };

  const repo = (await response.json()) as { full_name?: string; has_issues?: boolean; archived?: boolean };
  if (repo.archived) return { ok: false, message: `${repository} is archived, so it takes no new issues.` };
  if (repo.has_issues === false) {
    return { ok: false, message: `Issues are switched off in ${repository}. Turn them on in its settings.` };
  }
  return { ok: true, fullName: repo.full_name ?? repository };
}

export type CreatedIssue = { ok: true; number: number; url: string } | { ok: false; status: number; message: string };

export async function createIssue(
  repository: string,
  token: string,
  issue: { title: string; body: string },
): Promise<CreatedIssue> {
  const response = await fetch(`${API}/repos/${repository}/issues`, {
    method: 'POST',
    headers: headers(token),
    body: JSON.stringify(issue),
  });
  if (!response.ok) {
    const detail = (await response.json().catch(() => ({}))) as { message?: string };
    const hint =
      response.status === 403 || response.status === 404
        ? ' The token may lack Issues: write on this repository.'
        : response.status === 401
          ? ' The token may have expired; an owner can reconnect in Settings.'
          : '';
    return { ok: false, status: response.status, message: `${detail.message ?? `GitHub answered ${response.status}`}.${hint}` };
  }
  const created = (await response.json()) as { number: number; html_url: string };
  return { ok: true, number: created.number, url: created.html_url };
}
