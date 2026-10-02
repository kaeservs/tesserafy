import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ACTIONABLE_KINDS, ALARM_AT, alarming, groupFailures, type FailureRow } from '../src/health';

function row(kind: string, source: string, at: string, extra: Partial<FailureRow> = {}): FailureRow {
  return { kind, source, tier: null, model: null, status: null, message: `${kind} at ${source}`, created_at: at, ...extra };
}

describe('groupFailures', () => {
  it('treats twenty of the same failure as one problem, with its count and span', () => {
    const groups = groupFailures([
      row('model_unavailable', 'api/extract', '2026-09-27T10:00:00Z', { status: 529 }),
      row('model_unavailable', 'api/extract', '2026-09-27T12:00:00Z', { status: 529 }),
      row('model_unavailable', 'api/extract', '2026-09-27T11:00:00Z', { status: 529 }),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      count: 3,
      last: '2026-09-27T12:00:00Z',
      first: '2026-09-27T10:00:00Z',
      needsAPerson: false,
    });
  });

  it('keeps a 400 apart from a 401 from the same place', () => {
    const groups = groupFailures([
      row('model_rejected', 'api/detect', '2026-09-27T10:00:00Z', { status: 400 }),
      row('model_rejected', 'api/detect', '2026-09-27T10:01:00Z', { status: 401 }),
    ]);
    expect(groups.map((g) => g.status).sort()).toEqual([400, 401]);
  });

  it('puts what needs a person first, however rare, then the most frequent', () => {
    const groups = groupFailures([
      ...Array.from({ length: 5 }, (_, i) => row('model_unavailable', 'api/suggest', `2026-09-27T10:0${i}:00Z`)),
      row('database', 'api/transcripts', '2026-09-27T09:00:00Z'),
      row('input', 'api/transcripts', '2026-09-27T09:30:00Z'),
      row('input', 'api/transcripts', '2026-09-27T09:31:00Z'),
    ]);
    expect(groups.map((g) => g.kind)).toEqual(['database', 'model_unavailable', 'input']);
  });

  it('lists each company once, most recent first, and none when the failure knew no company', () => {
    const groups = groupFailures([
      row('database', 'api/extract', '2026-09-27T10:00:00Z', { company_id: 'a' }),
      row('database', 'api/extract', '2026-09-27T10:01:00Z', { company_id: 'a' }),
      row('database', 'api/extract', '2026-09-27T10:02:00Z', { company_id: 'b' }),
      row('model_rejected', 'api/detect', '2026-09-27T10:03:00Z', { company_id: null }),
    ]);
    expect(groups.find((g) => g.kind === 'database')?.companyIds).toEqual(['b', 'a']);
    expect(groups.find((g) => g.kind === 'model_rejected')?.companyIds).toEqual([]);
  });

  it('shows only the first line of a long message', () => {
    const [group] = groupFailures([
      row('unknown', 'script/score', '2026-09-27T10:00:00Z', { message: 'first line\nstack trace\nmore' }),
    ]);
    expect(group?.message).toBe('first line');
  });
});

describe('alarming', () => {
  it('stays quiet for weather and for a single bug of ours', () => {
    expect(
      alarming(
        groupFailures([
          ...Array.from({ length: 30 }, (_, i) => row('model_unavailable', 'api/detect', `2026-09-27T10:${String(i).padStart(2, '0')}:00Z`)),
          row('model_rejected', 'api/extract', '2026-09-27T11:00:00Z'),
        ]),
      ),
    ).toBe(0);
  });

  it('counts a bug of ours once it repeats', () => {
    expect(
      alarming(
        groupFailures([
          row('model_rejected', 'api/extract', '2026-09-27T11:00:00Z'),
          row('model_rejected', 'api/extract', '2026-09-27T11:05:00Z'),
          row('database', 'api/transcripts', '2026-09-27T11:06:00Z'),
        ]),
      ),
    ).toBe(2);
  });

  it('counts billing as needing a person: nothing fixes itself', () => {
    const groups = groupFailures([
      row('billing', 'api/ask', '2026-10-01T10:00:00Z', { status: 400 }),
      row('billing', 'api/ask', '2026-10-01T10:01:00Z', { status: 400 }),
    ]);
    expect(groups[0]?.needsAPerson).toBe(true);
    expect(alarming(groups)).toBe(2);
  });

  it('agrees with the alerting digest in the database about what needs a person', () => {
    // ops_digest (ADR 0019) repeats this judgement in SQL for the n8n alert; the two must not drift.
    const dir = join(__dirname, '../../../supabase/migrations');
    const sql = readdirSync(dir)
      .filter((name) => name.endsWith('.sql'))
      .sort()
      .map((name) => readFileSync(join(dir, name), 'utf8'))
      .filter((text) => /function public\.ops_digest\(/.test(text))
      .at(-1);
    expect(sql).toBeDefined();
    const kinds = [...(sql ?? '').matchAll(/f\.kind in \(([^)]*)\)/g)].map((match) =>
      (match[1] ?? '').split(',').map((kind) => kind.trim().replace(/'/g, '')).sort(),
    );
    expect(kinds.length).toBeGreaterThan(0);
    for (const list of kinds) expect(list).toEqual([...ACTIONABLE_KINDS].sort());
    expect(sql).toContain(`having count(*) >= ${ALARM_AT}`);
  });
});
