/**
 * The Jira and Linear clients: what an owner pastes becomes a target the
 * database accepts (and nothing that would point this server elsewhere), and
 * what each tracker answers becomes a sentence an owner can act on.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkJiraProject, normaliseJira, parseJiraCredentials } from '@/lib/jira-tracker';
import { checkLinearTeam, normaliseLinearTeam } from '@/lib/linear-tracker';
import { ticketBodyJira } from '@/lib/ticket';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('normaliseJira', () => {
  it('takes a site as pasted, and a project key in any case', () => {
    expect(normaliseJira('https://Acme.atlassian.net/jira/software/projects', 'prod')).toBe('acme.atlassian.net/PROD');
    expect(normaliseJira('acme.atlassian.net', 'PROD')).toBe('acme.atlassian.net/PROD');
  });

  it('refuses any host that is not a Jira Cloud site', () => {
    expect(normaliseJira('jira.internal.example', 'PROD')).toBeNull();
    expect(normaliseJira('169.254.169.254', 'PROD')).toBeNull();
    expect(normaliseJira('acme.atlassian.net.evil.example', 'PROD')).toBeNull();
    expect(normaliseJira('acme.atlassian.net', '1BAD')).toBeNull();
  });

  it('reads back only credentials it sealed', () => {
    expect(parseJiraCredentials('{"email":"pm@acme.test","token":"t"}')).toEqual({ email: 'pm@acme.test', token: 't' });
    expect(parseJiraCredentials('ghp_not_json')).toBeNull();
  });
});

describe('normaliseLinearTeam', () => {
  it('is a team key and nothing else', () => {
    expect(normaliseLinearTeam(' eng ')).toBe('ENG');
    expect(normaliseLinearTeam('https://api.linear.app')).toBeNull();
    expect(normaliseLinearTeam('ENG-12')).toBeNull();
  });
});

describe('what the trackers answer', () => {
  it('Jira: wrong credentials, and a project the account cannot see', async () => {
    vi.stubGlobal('fetch', async () => new Response('', { status: 401 }));
    await expect(checkJiraProject('acme.atlassian.net/PROD', { email: 'a@b.c', token: 't' })).resolves.toEqual({
      ok: false,
      message: 'Jira did not accept that email and API token.',
    });
    vi.stubGlobal('fetch', async () => new Response('', { status: 404 }));
    const missing = await checkJiraProject('acme.atlassian.net/PROD', { email: 'a@b.c', token: 't' });
    expect(missing.ok ? '' : missing.message).toContain('cannot see project PROD');
  });

  it('Linear: a key it refuses, and a team it cannot find', async () => {
    vi.stubGlobal('fetch', async () => Response.json({ errors: [{ message: 'Authentication required, not authenticated' }] }, { status: 400 }));
    await expect(checkLinearTeam('ENG', 'bad')).resolves.toEqual({ ok: false, message: 'Linear did not accept that API key.' });
    vi.stubGlobal('fetch', async () => Response.json({ data: { teams: { nodes: [] } } }));
    const missing = await checkLinearTeam('ENG', 'lin_api_key');
    expect(missing.ok ? '' : missing.message).toContain('cannot see a team called ENG');
  });
});

describe('ticketBodyJira', () => {
  it('is the same ticket in wiki markup: headings, links, lists and the rule', () => {
    const body = ticketBodyJira({
      title: 'Exports take a day',
      summary: 'Several customers lose Fridays.',
      insightUrl: 'https://app.example.com/insights/i1',
      citations: [{ quote: 'most of Friday', conversationId: 'c1', segmentId: 's1', startMs: 61_000 }],
    });
    expect(body).toContain('h2. Evidence');
    expect(body).toContain('* “most of Friday”');
    expect(body).toContain('[transcript|https://app.example.com/conversations/c1#segment-s1]');
    expect(body).toContain('[an insight in Tesserafy|https://app.example.com/insights/i1]');
    expect(body).toContain('\n----\n');
    expect(body).not.toMatch(/\]\(/);
  });
});
