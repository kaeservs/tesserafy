/**
 * CRM sync (ADR 0024), without HubSpot: a token is checked before it is kept,
 * the customer's record is found by its domain, a call is one note — made on
 * that record, rewritten when logged again, made afresh if someone deleted it
 * — and the note carries the words each met criterion rests on, escaped.
 */
import { describe, expect, it, vi } from 'vitest';
import { noteHtml } from '../lib/crm-note';
import { checkHubSpot, companyRecordUrl, findCompanyByDomain, writeNote } from '../lib/hubspot';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

function fakeHubSpot(answers: Response[]) {
  const doFetch = vi.fn(async () => answers.shift() ?? json(500, {}));
  const sent = () =>
    doFetch.mock.calls.map((args) => {
      const [url, init] = args as unknown as [string, RequestInit];
      return { url, method: init.method, body: init.body ? (JSON.parse(String(init.body)) as unknown) : null };
    });
  return { doFetch: doFetch as unknown as typeof fetch, sent };
}

describe('checkHubSpot', () => {
  it('says which account the token is for, once it can read companies', async () => {
    const { doFetch } = fakeHubSpot([json(200, { portalId: 12345678 }), json(200, { results: [] })]);
    expect(await checkHubSpot('pat-na1-token', doFetch)).toEqual({ ok: true, portalId: '12345678' });
  });
  it('refuses a token HubSpot does not accept, or one missing the scopes', async () => {
    expect(await checkHubSpot('bad', fakeHubSpot([json(401, {})]).doFetch)).toMatchObject({ ok: false, message: expect.stringMatching(/did not accept/) });
    expect(await checkHubSpot('narrow', fakeHubSpot([json(200, { portalId: 1 }), json(403, {})]).doFetch)).toMatchObject({
      ok: false,
      message: expect.stringMatching(/cannot read companies/),
    });
  });
});

describe('logging a call', () => {
  it('finds the customer by domain and puts the note on its record', async () => {
    const { doFetch, sent } = fakeHubSpot([json(200, { results: [{ id: '501', properties: { name: 'Northwind' } }] }), json(201, { id: '9001' })]);
    const record = await findCompanyByDomain('t', 'northwind.com', doFetch);
    expect(record).toEqual({ id: '501', name: 'Northwind' });
    expect(await writeNote('t', { existingId: null, html: '<p>x</p>', at: '2026-10-04T10:00:00.000Z', companyId: '501' }, doFetch)).toBe('9001');
    const [search, create] = sent();
    expect(search?.body).toMatchObject({ filterGroups: [{ filters: [{ propertyName: 'domain', operator: 'EQ', value: 'northwind.com' }] }] });
    expect(create).toMatchObject({
      url: 'https://api.hubapi.com/crm/v3/objects/notes',
      method: 'POST',
      body: {
        properties: { hs_note_body: '<p>x</p>', hs_timestamp: '2026-10-04T10:00:00.000Z' },
        associations: [{ to: { id: '501' }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 190 }] }],
      },
    });
  });

  it('rewrites the same note when logged again, and makes a new one if it was deleted in HubSpot', async () => {
    const again = fakeHubSpot([json(200, { id: '9001' })]);
    expect(await writeNote('t', { existingId: '9001', html: 'y', at: 'a', companyId: '501' }, again.doFetch)).toBe('9001');
    expect(again.sent()[0]).toMatchObject({ url: 'https://api.hubapi.com/crm/v3/objects/notes/9001', method: 'PATCH' });

    const gone = fakeHubSpot([json(404, {}), json(201, { id: '9002' })]);
    expect(await writeNote('t', { existingId: '9001', html: 'y', at: 'a', companyId: '501' }, gone.doFetch)).toBe('9002');
  });

  it('says nothing was found rather than guessing a record', async () => {
    expect(await findCompanyByDomain('t', 'nobody.test', fakeHubSpot([json(200, { results: [] })]).doFetch)).toBeNull();
    expect(companyRecordUrl('123', '501')).toBe('https://app.hubspot.com/contacts/123/record/0-2/501');
  });
});

describe('noteHtml', () => {
  it('carries the score, the words each met criterion rests on, the action items and the way back, escaped', () => {
    const html = noteHtml({
      title: 'Northwind <discovery>',
      when: '4 Oct 2026',
      scorecard: 'Discovery',
      score: 60,
      criteria: [
        { label: 'Pain', met: true, quote: 'it takes us two full days & a "war room"' },
        { label: 'Budget', met: false, quote: null },
      ],
      actions: [{ action: 'Send the integration guide', ours: true, done: false }],
      url: 'https://app.tesserafy.test/conversations/abc',
    });
    expect(html).toContain('<strong>Northwind &lt;discovery&gt;</strong>');
    expect(html).toContain('<strong>60/100</strong>');
    expect(html).toContain('<li>Pain: met — “it takes us two full days &amp; a &quot;war room&quot;”</li>');
    expect(html).toContain('<li>Budget: not yet</li>');
    expect(html).toContain('<li>Send the integration guide (ours)</li>');
    expect(html).toContain('href="https://app.tesserafy.test/conversations/abc"');
  });

  it('says no score for a call nothing was scored on', () => {
    const html = noteHtml({ title: 'T', when: 'w', scorecard: 'Discovery', score: null, criteria: [], actions: [], url: 'u' });
    expect(html).not.toContain('/100');
  });
});
