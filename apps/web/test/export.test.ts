import { describe, expect, it } from 'vitest';
import { assembleExport, exportFilename, type ExportParts } from '../lib/export';

function parts(overrides: Partial<ExportParts> = {}): ExportParts {
  return {
    exportId: 'x1',
    exportedAt: '2026-09-27T10:00:00.000Z',
    exportedBy: 'owner@acme.test',
    companyName: 'Acme Robotics',
    team: [{ email: 'owner@acme.test', role: 'owner', joined_at: '2026-09-01T00:00:00Z' }],
    conversations: [
      {
        id: 'c1',
        title: 'Discovery',
        occurred_at: '2026-09-20T15:00:00Z',
        created_at: '2026-09-21T09:00:00Z',
        engagement_type: 'discovery',
        criteria_version: 1,
        consent_statement: 'Everyone agreed.',
        consent_confirmed_at: '2026-09-21T09:00:00Z',
      },
      {
        id: 'c2',
        title: 'Follow-up',
        occurred_at: null,
        created_at: '2026-09-22T09:00:00Z',
        engagement_type: 'discovery',
        criteria_version: 1,
        consent_statement: null,
        consent_confirmed_at: null,
      },
    ],
    segments: [
      { id: 's2', conversation_id: 'c1', speaker: 'customer', start_ms: 9000, end_ms: 12000, text: 'second' },
      { id: 's1', conversation_id: 'c1', speaker: 'customer', start_ms: 1000, end_ms: 8000, text: 'first' },
      { id: 's3', conversation_id: 'c2', speaker: null, start_ms: 0, end_ms: 1000, text: 'other call' },
    ],
    criterionEvents: [
      {
        conversation_id: 'c1',
        criterion_key: 'pain_quantified',
        kind: 'evidence',
        confidence: 0.9,
        segment_id: 's1',
        quote: 'first',
        detector: 't1',
        model: 'claude-haiku-4-5',
        created_at: '2026-09-21T09:01:00Z',
      },
    ],
    signals: [
      { id: 'g1', conversation_id: 'c1', kind: 'problem', summary: 'slow export', confidence: 0.8 },
      { id: 'g2', conversation_id: 'c2', kind: 'feature_request', summary: 'an API', confidence: 0.7 },
    ],
    signalEvidence: [
      { signal_id: 'g1', segment_id: 's2', quote: 'second' },
      { signal_id: 'g2', segment_id: 's3', quote: 'other call' },
    ],
    insights: [
      {
        id: 'i1',
        title: 'Exports are slow',
        summary: 'Two calls say so.',
        status: 'approved',
        created_at: '2026-09-23T00:00:00Z',
        decided_at: '2026-09-24T00:00:00Z',
      },
    ],
    insightEvidence: [
      { insight_id: 'i1', signal_id: 'g1' },
      { insight_id: 'i1', signal_id: 'g2' },
    ],
    erasures: [
      {
        conversation_id: 'gone',
        reason: 'request',
        created_at: '2026-09-25T00:00:00Z',
        segments_removed: 12,
        signals_removed: 2,
      },
    ],
    scores: new Map([
      ['c1', { score: 39.6, criteria: [{ key: 'pain_quantified', label: 'Pain quantified', status: 'confirmed' }] }],
    ]),
    ...overrides,
  };
}

describe('assembleExport', () => {
  it('puts each call\'s transcript, evidence and signals under that call and no other', () => {
    const out = assembleExport(parts());
    const [c1, c2] = out.conversations;

    expect(c1?.transcript.map((s) => s.text)).toEqual(['first', 'second']);
    expect(c2?.transcript.map((s) => s.text)).toEqual(['other call']);
    expect(c1?.criterion_evidence.map((e) => e.quote)).toEqual(['first']);
    expect(c2?.criterion_evidence).toEqual([]);
    expect(c1?.signals.map((s) => s.id)).toEqual(['g1']);
    expect(c1?.signals[0]?.evidence).toEqual([{ segment_id: 's2', quote: 'second' }]);
    expect(c2?.signals[0]?.evidence).toEqual([{ segment_id: 's3', quote: 'other call' }]);
  });

  it('orders a transcript by time, whatever order the rows came in', () => {
    const out = assembleExport(parts());
    expect(out.conversations[0]?.transcript.map((s) => s.segment_id)).toEqual(['s1', 's2']);
  });

  it('gives a computed score rounded for reading, and null for a call never scored', () => {
    const out = assembleExport(parts());
    expect(out.conversations[0]?.score).toBe(40);
    expect(out.conversations[1]?.score).toBeNull();
    expect(out.about.join(' ')).toContain('Scores are not stored');
  });

  it('keeps consent as recorded, and says none rather than inventing one', () => {
    const out = assembleExport(parts());
    expect(out.conversations[0]?.recording_consent).toEqual({
      statement: 'Everyone agreed.',
      confirmed_at: '2026-09-21T09:00:00Z',
    });
    expect(out.conversations[1]?.recording_consent).toBeNull();
  });

  it('lists what each insight cites, across calls', () => {
    const out = assembleExport(parts());
    expect(out.insights[0]?.cited_signal_ids).toEqual(['g1', 'g2']);
  });

  it('carries the erasure log, which names no content', () => {
    const out = assembleExport(parts());
    expect(out.erasures).toEqual([
      { conversation_id: 'gone', reason: 'request', erased_at: '2026-09-25T00:00:00Z', segments_removed: 12, signals_removed: 2 },
    ]);
  });

  it('is plain JSON all the way down', () => {
    const out = assembleExport(parts());
    expect(JSON.parse(JSON.stringify(out))).toEqual(out);
  });
});

describe('exportFilename', () => {
  it('names the company and the day, safely', () => {
    expect(exportFilename('Acme Robotics', new Date('2026-09-27T10:00:00Z'))).toBe(
      'tesserafy-export-acme-robotics-2026-09-27.json',
    );
    expect(exportFilename('Load test — synthetic, not a customer', new Date('2026-09-27T10:00:00Z'))).toBe(
      'tesserafy-export-load-test-synthetic-not-a-customer-2026-09-27.json',
    );
    expect(exportFilename('///', new Date('2026-09-27T10:00:00Z'))).toBe('tesserafy-export-company-2026-09-27.json');
  });
});
