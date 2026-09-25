/**
 * The read path that turns stored evidence into a scorecard.
 *
 * What is pinned here is invariant 1 at the place it is easiest to lose: the
 * database holds quoted spans and confidences, and the number is produced by
 * packages/scoring every time the page loads. The last test is the one that
 * matters — the same rows under a stricter threshold must produce a different
 * score, because that is the property a stored snapshot would silently break.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

interface Criterion {
  key: string;
  label: string;
  confirm_threshold: number;
}

let criteria: Criterion[];
let events: Record<string, unknown>[];
let criteriaFetches: number;

function criteriaRows() {
  criteriaFetches += 1;
  return criteria.map((criterion, index) => ({
    engagement_type: 'discovery',
    version: 1,
    key: criterion.key,
    label: criterion.label,
    definition: 'whatever counts as evidence',
    weight: 1,
    candidate_threshold: 0.55,
    confirm_threshold: criterion.confirm_threshold,
    corroborating_segments: 2,
    position: index + 1,
  }));
}

/** Enough of PostgREST's builder for fetchCriteria and fetchCriterionEvents. */
function builder(table: string) {
  const rows = () => (table === 'criteria_definitions' ? criteriaRows() : events);
  // A range is honoured, as the server honours it: events are read a page at
  // a time until a page comes back empty, so a fake that ignored it would
  // hand back the same rows forever.
  let window: [number, number] | null = null;
  const chain: Record<string, unknown> = {
    select: () => chain,
    eq: () => chain,
    in: () => chain,
    order: () => chain,
    range: (from: number, to: number) => {
      window = [from, to];
      return chain;
    },
    then: (resolve: (value: { data: unknown[]; error: null }) => unknown) =>
      resolve({ data: window ? rows().slice(window[0], window[1] + 1) : rows(), error: null }),
  };
  return chain;
}

const db = { from: (table: string) => builder(table) };

vi.mock('@/lib/supabase/server', () => ({ createClient: async () => db }));

const { scoreConversations, scoreConversation } = await import('@/lib/scorecard');

const conversation = { id: 'c1', engagement_type: 'discovery', criteria_version: 1 };

function evidence(criterionKey: string, segmentId: string, confidence: number, startMs: number) {
  return {
    conversation_id: 'c1',
    criterion_key: criterionKey,
    kind: 'evidence',
    confidence,
    segment_id: segmentId,
    quote: 'it takes us most of Friday',
    quote_start: 0,
    quote_end: 26,
    detector: 't1-detect@test',
    model: 'claude-haiku-4-5',
    created_at: '2026-09-22T10:00:00Z',
    segments: { start_ms: startMs, end_ms: startMs + 4000 },
  };
}

beforeEach(() => {
  criteriaFetches = 0;
  events = [];
  criteria = [
    { key: 'pain_quantified', label: 'Pain quantified', confirm_threshold: 0.8 },
    { key: 'budget_known', label: 'Budget known', confirm_threshold: 0.8 },
  ];
});

describe('scoring a conversation from stored evidence', () => {
  it('gives an unscored conversation a scorecard, not an error', async () => {
    // A meeting nobody has run the scoring pass over must be distinguishable
    // from one that scored zero — the caller renders them differently, and it
    // can only do that if both come back.
    const card = await scoreConversation(db as never, conversation);

    expect(card.scorecard.score).toBe(0);
    expect(card.scorecard.criteria.map((c) => c.status)).toEqual(['unobserved', 'unobserved']);
    expect(card.detectors).toEqual([]);
  });

  it('confirms a criterion from a single confident span', async () => {
    events = [evidence('pain_quantified', 'seg1', 0.91, 61000)];

    const card = await scoreConversation(db as never, conversation);
    const pain = card.scorecard.criteria.find((c) => c.key === 'pain_quantified');

    expect(pain?.status).toBe('confirmed');
    expect(pain?.evidence[0]?.span.quote).toBe('it takes us most of Friday');
    // The span's timestamps come from the segment, never from the event row.
    expect(pain?.evidence[0]?.span.startMs).toBe(61000);
    expect(card.detectors).toEqual(['t1-detect@test']);
  });

  it('scores the whole list with one criteria fetch per distinct set', async () => {
    // Twenty discovery calls pinning the same set must not be twenty identical
    // queries; that is the difference between a dashboard and a loading page.
    const many = ['c1', 'c2', 'c3'].map((id) => ({ ...conversation, id }));

    const scores = await scoreConversations(db as never, many);

    expect(scores.size).toBe(3);
    expect(criteriaFetches).toBe(1);
  });

  it('re-scores history when the threshold changes, because nothing is stored', async () => {
    // The same evidence, read twice, under two different criteria sets. A
    // stored score would answer the same both times and one of the answers
    // would be wrong.
    events = [evidence('pain_quantified', 'seg1', 0.85, 61000)];

    const lenient = await scoreConversation(db as never, conversation);
    expect(lenient.scorecard.criteria[0]?.status).toBe('confirmed');

    criteria = [
      { key: 'pain_quantified', label: 'Pain quantified', confirm_threshold: 0.95 },
      { key: 'budget_known', label: 'Budget known', confirm_threshold: 0.95 },
    ];

    const strict = await scoreConversation(db as never, conversation);
    expect(strict.scorecard.criteria[0]?.status).toBe('candidate');
    expect(strict.scorecard.score).toBeLessThan(lenient.scorecard.score);
  });

  it('replays in conversation order, not in the order rows came back', async () => {
    // Latching makes the final status order-independent; the transitions are
    // the audit trail and are not. "Confirmed at 04:12 by this quote" has to
    // be the same answer every time it is asked.
    events = [
      evidence('pain_quantified', 'seg9', 0.6, 240000),
      evidence('pain_quantified', 'seg2', 0.6, 61000),
    ];

    const card = await scoreConversation(db as never, conversation);
    const pain = card.scorecard.criteria.find((c) => c.key === 'pain_quantified');

    expect(pain?.evidence.map((e) => e.span.startMs)).toEqual([61000, 240000]);
    // Two corroborating segments, each above the candidate threshold.
    expect(pain?.status).toBe('confirmed');
  });
});
