import { redact } from '@tesserafy/ingest';

/**
 * Web research for a call prep, through Apify: the person's LinkedIn profile
 * and a search on their company. Server only; off unless APIFY_TOKEN is set.
 *
 * The owner of the platform chose this knowing LinkedIn's terms forbid
 * automated collection; it stays behind that setting and a per-prep choice.
 *
 * Actors are settings, not code (APIFY_LINKEDIN_ACTOR, APIFY_SEARCH_ACTOR),
 * because community actors come and go and each shapes its output its own
 * way. So nothing here depends on one actor's fields: whatever comes back is
 * flattened into labelled text, contact details dropped, redacted like a
 * transcript, and the brief may only quote that text.
 */

export const DEFAULT_LINKEDIN_ACTOR = 'dev_fusion~linkedin-profile-scraper';
export const DEFAULT_SEARCH_ACTOR = 'apify~google-search-scraper';
/** Overridable only so a check can stand a local server in for Apify. */
const api = () => process.env['APIFY_API_BASE'] ?? 'https://api.apify.com/v2';
/** Seconds Apify may take to answer; a prep is waited on by a person. */
const TIMEOUT = 90;
/** Enough to brief from; bounded so one profile cannot fill the prompt. */
const MAX_TEXT = 6000;

export interface Source {
  readonly id: string;
  readonly kind: 'linkedin' | 'web';
  readonly url: string;
  readonly title: string;
  readonly text: string;
}

export interface Research {
  readonly linkedinUrl: string | null;
  readonly company: string | null;
  readonly sources: readonly Source[];
}

export function researchAvailable(): boolean {
  return Boolean(process.env['APIFY_TOKEN']);
}

type Fetch = typeof fetch;

/** Run an actor and return its dataset items, or throw with Apify's reason. */
export async function runActor(actor: string, input: unknown, fetcher: Fetch = fetch): Promise<unknown[]> {
  const token = process.env['APIFY_TOKEN'];
  if (!token) throw new Error('Apify is not configured on this deployment');
  const response = await fetcher(`${api()}/actors/${encodeURIComponent(actor).replace('%7E', '~')}/run-sync-get-dataset-items?timeout=${TIMEOUT}`, {
    method: 'POST',
    // In the header, not the URL: URLs end up in logs.
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    const detail = (await response.text().catch(() => '')).slice(0, 200);
    throw new Error(`Apify ${actor} answered ${response.status}${detail ? `: ${detail}` : ''}`);
  }
  const items = (await response.json()) as unknown;
  return Array.isArray(items) ? items : [];
}

/** Keys never kept: how to reach the person, pictures, and machine identifiers. */
/** Anywhere in a key, any case: how to reach someone. */
const CONTACT = /email|phone|mobile|contact|photo|picture|avatar|cookie|tracking/i;
/** The whole key, case as written: identifiers, addresses, pictures — "turnover" and "paid" stay. */
const IDENTIFIER = /^(id|urn|[a-z]+Id|[a-z]+_id|[a-z]*Urn|address|[a-z]+Address|image|[a-z]+Image|logo|[a-z]+Logo|profilePic\w*)$/;
const DROP = { test: (key: string) => CONTACT.test(key) || IDENTIFIER.test(key) };

/**
 * Any actor's item as labelled lines — "headline: Head of Finance
 * Operations", "experiences.0.title: …" — text only, contact details and
 * identifiers dropped, capped. Numbers and booleans are kept where short;
 * nested objects and arrays are walked.
 */
export function flatten(item: unknown, max = MAX_TEXT): string {
  const lines: string[] = [];
  const walk = (value: unknown, path: string, depth: number) => {
    if (lines.join('\n').length > max || depth > 5 || value === null || value === undefined) return;
    const key = path.split('.').pop() ?? '';
    if (key && DROP.test(key)) return;
    if (typeof value === 'string') {
      const text = value.replace(/\s+/g, ' ').trim();
      if (text && !/^https?:\/\//.test(text)) lines.push(`${path}: ${text}`);
    } else if (typeof value === 'number' || typeof value === 'boolean') {
      if (path) lines.push(`${path}: ${String(value)}`);
    } else if (Array.isArray(value)) {
      value.slice(0, 12).forEach((entry, index) => walk(entry, path ? `${path}.${index}` : String(index), depth + 1));
    } else if (typeof value === 'object') {
      for (const [name, entry] of Object.entries(value as Record<string, unknown>)) walk(entry, path ? `${path}.${name}` : name, depth + 1);
    }
  };
  walk(item, '', 0);
  const text = lines.join('\n');
  return redact(text.length > max ? text.slice(0, max) : text).text;
}

/** The company name a LinkedIn item gives, under any of the usual keys. */
export function companyOf(item: unknown): string | null {
  if (!item || typeof item !== 'object') return null;
  const record = item as Record<string, unknown>;
  for (const key of ['companyName', 'current_company', 'currentCompany', 'company']) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (value && typeof value === 'object' && typeof (value as Record<string, unknown>)['name'] === 'string') {
      return String((value as Record<string, unknown>)['name']).trim();
    }
  }
  return null;
}

/** Search results as sources: title and snippet, each with its link. */
export function searchSources(items: readonly unknown[], startAt: number, limit = 6): Source[] {
  const results: Source[] = [];
  for (const item of items) {
    const organic = (item as Record<string, unknown> | null)?.['organicResults'];
    const list = Array.isArray(organic) ? organic : [item];
    for (const result of list) {
      const record = result as Record<string, unknown> | null;
      const url = typeof record?.['url'] === 'string' ? record['url'] : null;
      const title = typeof record?.['title'] === 'string' ? record['title'].trim() : '';
      const description = typeof record?.['description'] === 'string' ? record['description'].trim() : '';
      if (!url || !/^https?:\/\//.test(url) || (!title && !description)) continue;
      if (results.some((source) => source.url === url)) continue;
      results.push({
        id: `s${startAt + results.length}`,
        kind: 'web',
        url,
        title: redact(title).text,
        text: redact(`${title}. ${description}`).text,
      });
      if (results.length >= limit) return results;
    }
  }
  return results;
}

/** What to search for their company: on a sales call, what bears on buying. */
export function companyQueries(company: string, purpose: string): string[] {
  const name = `"${company.replace(/"/g, '')}"`;
  return purpose === 'sales'
    ? [`${name} news`, `${name} funding OR expansion OR hiring OR acquisition`]
    : [`${name} news`];
}

/**
 * Research a person and their company. Each part fails on its own — a
 * profile the actor cannot read still leaves the company search, and the
 * other way round — and the whole never blocks the brief: an empty list of
 * sources is a brief from what was pasted.
 */
export async function research(
  input: { linkedinUrl: string | null; company: string | null; purpose: string },
  fetcher: Fetch = fetch,
): Promise<Research & { errors: string[] }> {
  const sources: Source[] = [];
  const errors: string[] = [];
  let company = input.company;
  if (input.linkedinUrl) {
    try {
      const items = await runActor(process.env['APIFY_LINKEDIN_ACTOR'] ?? DEFAULT_LINKEDIN_ACTOR, { profileUrls: [input.linkedinUrl] }, fetcher);
      const profile = items[0];
      if (profile) {
        const text = flatten(profile);
        if (text) sources.push({ id: 's1', kind: 'linkedin', url: input.linkedinUrl, title: 'LinkedIn profile', text });
        company ??= companyOf(profile);
      }
    } catch (cause) {
      errors.push(cause instanceof Error ? cause.message : String(cause));
    }
  }
  if (company) {
    try {
      const items = await runActor(
        process.env['APIFY_SEARCH_ACTOR'] ?? DEFAULT_SEARCH_ACTOR,
        { queries: companyQueries(company, input.purpose).join('\n'), maxPagesPerQuery: 1, resultsPerPage: 10 },
        fetcher,
      );
      sources.push(...searchSources(items, sources.length + 1));
    } catch (cause) {
      errors.push(cause instanceof Error ? cause.message : String(cause));
    }
  }
  return { linkedinUrl: input.linkedinUrl, company, sources, errors };
}
