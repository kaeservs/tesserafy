import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkRepository, createIssue, normaliseRepository } from '../lib/github-tracker';

describe('normaliseRepository', () => {
  it('takes what an owner is likely to paste', () => {
    expect(normaliseRepository('acme/product')).toBe('acme/product');
    expect(normaliseRepository(' https://github.com/acme/product ')).toBe('acme/product');
    expect(normaliseRepository('https://github.com/acme/product.git')).toBe('acme/product');
    expect(normaliseRepository('https://github.com/acme/product/')).toBe('acme/product');
  });

  it('refuses anything else', () => {
    expect(normaliseRepository('acme')).toBeNull();
    expect(normaliseRepository('https://gitlab.com/acme/product')).toBeNull();
    expect(normaliseRepository('acme/product/issues')).toBeNull();
    expect(normaliseRepository('acme/pro duct')).toBeNull();
  });
});

describe('GitHub', () => {
  afterEach(() => vi.unstubAllGlobals());

  function answer(status: number, body: unknown) {
    const fetch = vi.fn(async () => new Response(JSON.stringify(body), { status }));
    vi.stubGlobal('fetch', fetch);
    return fetch;
  }

  it('accepts a readable repository with issues on, sending the token only to GitHub', async () => {
    const fetch = answer(200, { full_name: 'Acme/Product', has_issues: true });
    expect(await checkRepository('acme/product', 'tok')).toEqual({ ok: true, fullName: 'Acme/Product' });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.github.com/repos/acme/product');
    expect((init.headers as Record<string, string>)['authorization']).toBe('Bearer tok');
  });

  it('says why a repository will not do', async () => {
    answer(401, {});
    expect(await checkRepository('acme/product', 'tok')).toMatchObject({ ok: false, message: expect.stringContaining('token') });
    answer(404, {});
    expect(await checkRepository('acme/product', 'tok')).toMatchObject({ ok: false, message: expect.stringContaining('cannot see') });
    answer(200, { has_issues: false });
    expect(await checkRepository('acme/product', 'tok')).toMatchObject({ ok: false, message: expect.stringContaining('switched off') });
    answer(200, { archived: true, has_issues: true });
    expect(await checkRepository('acme/product', 'tok')).toMatchObject({ ok: false, message: expect.stringContaining('archived') });
  });

  it('opens an issue and returns its number and address', async () => {
    const fetch = answer(201, { number: 42, html_url: 'https://github.com/acme/product/issues/42' });
    expect(await createIssue('acme/product', 'tok', { title: 't', body: 'b' })).toEqual({
      ok: true,
      number: 42,
      url: 'https://github.com/acme/product/issues/42',
    });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.github.com/repos/acme/product/issues');
    expect(init.method).toBe('POST');
  });

  it('turns a refusal into something an owner can act on', async () => {
    answer(403, { message: 'Resource not accessible by personal access token' });
    const result = await createIssue('acme/product', 'tok', { title: 't', body: 'b' });
    expect(result).toMatchObject({ ok: false, status: 403, message: expect.stringContaining('Issues: write') });
  });
});
