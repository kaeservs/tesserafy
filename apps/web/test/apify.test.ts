/**
 * Web research for a call prep, with Apify stood in for by fixtures shaped
 * like its answers. Pinned: contact details never survive flattening, the
 * token travels in a header, one part failing leaves the other, and search
 * results become linked sources.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { companyQueries, flatten, research, searchSources } from '@/lib/apify';

const PROFILE = {
  fullName: 'Priya Raman',
  headline: 'Head of Finance Operations at Acme Robotics',
  email: 'priya@acme.example',
  mobileNumber: '+44 20 7946 0958',
  profilePic: 'https://media.licdn.com/p.jpg',
  companyName: 'Acme Robotics',
  about: 'I run finance operations for a 400-person robotics manufacturer.',
  experiences: [{ title: 'Head of Finance Operations', companyName: 'Acme Robotics', companyId: '123' }],
};
const SEARCH = [
  {
    organicResults: [
      { title: 'Acme Robotics opens a second plant', url: 'https://news.example/acme-plant', description: 'The plant adds 200 jobs.' },
      { title: 'No link', description: 'Dropped.' },
      { title: 'Acme Robotics raises $40m', url: 'https://news.example/acme-raise', description: 'Series C led by Northwind.' },
    ],
  },
];

describe('flatten', () => {
  it('keeps what someone is, and drops how to reach them', () => {
    const text = flatten(PROFILE);
    expect(text).toContain('headline: Head of Finance Operations at Acme Robotics');
    expect(text).toContain('experiences.0.title: Head of Finance Operations');
    expect(text).not.toContain('priya@acme.example');
    expect(text).not.toContain('7946');
    expect(text).not.toContain('media.licdn.com');
    expect(text).not.toContain('companyId');
  });

  it('drops contact fields by name, whatever they end in, before redaction has to catch them', () => {
    const text = flatten({ mobileNumber: 'ext 12', emailAddress: 'at the office', phoneNumbers: ['ext 13'], companyId: '99', topic: 'Finance', turnover: '40m', paid: true });
    expect(text).toBe(['topic: Finance', 'turnover: 40m', 'paid: true'].join('\n'));
  });

  it('masks an address that arrives under an innocent key', () => {
    expect(flatten({ about: 'Write to priya@acme.example any time.' })).toContain('[email]');
  });
});

describe('searchSources', () => {
  it('turns results into linked sources, skipping ones without a link', () => {
    expect(searchSources(SEARCH, 2).map((source) => [source.id, source.url])).toEqual([
      ['s2', 'https://news.example/acme-plant'],
      ['s3', 'https://news.example/acme-raise'],
    ]);
  });
});

describe('companyQueries', () => {
  it('looks for what bears on buying on a sales call', () => {
    expect(companyQueries('Acme Robotics', 'sales')).toEqual(['"Acme Robotics" news', '"Acme Robotics" funding OR expansion OR hiring OR acquisition']);
    expect(companyQueries('Acme Robotics', 'support')).toEqual(['"Acme Robotics" news']);
  });
});

describe('research', () => {
  const saved = process.env['APIFY_TOKEN'];
  beforeEach(() => {
    process.env['APIFY_TOKEN'] = 'test-token';
  });
  afterEach(() => {
    if (saved === undefined) delete process.env['APIFY_TOKEN'];
    else process.env['APIFY_TOKEN'] = saved;
  });

  it('reads the profile, finds the company from it, and searches for it — token in the header, not the URL', async () => {
    const calls: { url: string; auth: string | null; body: unknown }[] = [];
    const fetcher = (async (url: string, init: RequestInit) => {
      calls.push({ url, auth: new Headers(init.headers).get('authorization'), body: JSON.parse(String(init.body)) });
      return new Response(JSON.stringify(url.includes('linkedin') ? [PROFILE] : SEARCH), { status: 201 });
    }) as unknown as typeof fetch;
    const result = await research({ linkedinUrl: 'https://www.linkedin.com/in/priya-raman-example/', company: null, purpose: 'sales' }, fetcher);
    expect(result.company).toBe('Acme Robotics');
    expect(result.sources.map((source) => source.kind)).toEqual(['linkedin', 'web', 'web']);
    expect(calls[0]!.url).toContain('/v2/actors/dev_fusion~linkedin-profile-scraper/run-sync-get-dataset-items');
    expect(calls.every((call) => call.auth === 'Bearer test-token' && !call.url.includes('test-token'))).toBe(true);
    expect(calls[0]!.body).toEqual({ profileUrls: ['https://www.linkedin.com/in/priya-raman-example/'] });
  });

  it('keeps the company search when the profile cannot be read', async () => {
    const fetcher = (async (url: string) =>
      url.includes('linkedin') ? new Response('blocked', { status: 403 }) : new Response(JSON.stringify(SEARCH), { status: 201 })) as unknown as typeof fetch;
    const result = await research({ linkedinUrl: 'https://www.linkedin.com/in/x-y/', company: 'Acme Robotics', purpose: 'sales' }, fetcher);
    expect(result.sources.map((source) => source.kind)).toEqual(['web', 'web']);
    expect(result.errors[0]).toContain('403');
  });
});
