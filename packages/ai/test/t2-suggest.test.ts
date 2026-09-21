/**
 * T2 without the API.
 *
 * What these pin is the rule that makes a suggestion trustworthy: it must
 * serve a criterion the scorecard actually lacks, and it must point at
 * something the customer really said. Everything else about a suggestion is
 * taste; these two are the product's claim.
 */
import type Anthropic from '@anthropic-ai/sdk';
import { defineCriteriaSet, initialState, score, apply } from '@tesserafy/scoring';
import { describe, expect, it, vi } from 'vitest';
import { suggestNext, T2_MODEL, type SuggestableSegment } from '../src/index';

const CRITERIA = defineCriteriaSet({
  engagementType: 'discovery',
  version: 1,
  criteria: [
    { key: 'pain_quantified', label: 'Pain quantified', weight: 1 },
    { key: 'timeline_stated', label: 'Timeline stated', weight: 1 },
  ],
});

const WINDOW: SuggestableSegment[] = [
  {
    id: 's1',
    speaker: 'customer',
    text: 'We export the report by hand every Friday and it is a nightmare.',
  },
  { id: 's2', speaker: 'seller', text: 'How long does that take you?' },
];

function fakeClient(output: Record<string, unknown> | null) {
  const parse = vi.fn(async (_params: Record<string, unknown>) => ({
    parsed_output: output,
    stop_reason: 'end_turn',
    stop_details: null,
    usage: { input_tokens: 400, output_tokens: 60 },
  }));
  return { client: { messages: { parse } } as unknown as Anthropic, parse };
}

const suggestion = (overrides: Record<string, unknown> = {}) => ({
  worth_asking: true,
  criterion_key: 'pain_quantified',
  ask: 'How many hours does that cost you each week?',
  because: 'We export the report by hand every Friday',
  segment_id: 's1',
  ...overrides,
});

describe('suggestNext', () => {
  const fresh = score(initialState(CRITERIA));

  it('suggests one question, anchored to the customer’s words', async () => {
    const { client } = fakeClient(suggestion());

    const result = await suggestNext(fresh, WINDOW, { client, onUsage: () => {} });

    expect(result).toMatchObject({
      criterionKey: 'pain_quantified',
      ask: 'How many hours does that cost you each week?',
      because: 'We export the report by hand every Friday',
      segmentId: 's1',
      model: T2_MODEL,
    });
  });

  it('quotes the segment, not the model’s copy of it', async () => {
    const { client } = fakeClient(suggestion({ because: 'export the report by hand' }));

    const result = await suggestNext(fresh, WINDOW, { client, onUsage: () => {} });

    expect('because' in result && WINDOW[0]!.text.includes(result.because)).toBe(true);
  });

  it('refuses a justification that is not in the window', async () => {
    // A suggestion justified by a paraphrase is justified by nothing.
    const { client } = fakeClient(suggestion({ because: 'they hate their reporting process' }));

    expect(await suggestNext(fresh, WINDOW, { client, onUsage: () => {} })).toMatchObject({
      reason: 'unquotable',
    });
  });

  it('refuses a justification attributed to the wrong segment', async () => {
    const { client } = fakeClient(suggestion({ segment_id: 's2' }));

    expect(await suggestNext(fresh, WINDOW, { client, onUsage: () => {} })).toMatchObject({
      reason: 'unquotable',
    });
  });

  it('refuses a criterion nobody defined', async () => {
    const { client } = fakeClient(suggestion({ criterion_key: 'rapport_built' }));

    expect(await suggestNext(fresh, WINDOW, { client, onUsage: () => {} })).toMatchObject({
      reason: 'unknown-criterion',
    });
  });

  it('refuses a criterion that is already confirmed', async () => {
    // Asking about something the customer has answered wastes the one thing
    // this is spending: the reader's attention mid-conversation.
    const confirmed = score(
      apply(initialState(CRITERIA), {
        kind: 'evidence',
        criterionKey: 'pain_quantified',
        confidence: 0.95,
        span: { segmentId: 's1', startMs: 0, endMs: 1000, quote: 'every Friday' },
      }),
    );
    const { client } = fakeClient(suggestion());

    expect(await suggestNext(confirmed, WINDOW, { client, onUsage: () => {} })).toMatchObject({
      reason: 'unknown-criterion',
    });
  });

  it('accepts the model declining to suggest anything', async () => {
    const { client } = fakeClient(suggestion({ worth_asking: false }));

    expect(await suggestNext(fresh, WINDOW, { client, onUsage: () => {} })).toMatchObject({
      reason: 'declined',
    });
  });

  it('does not call the model when every criterion is confirmed', async () => {
    // Asking anyway is how filler gets invented.
    let state = initialState(CRITERIA);
    for (const key of ['pain_quantified', 'timeline_stated']) {
      state = apply(state, {
        kind: 'evidence',
        criterionKey: key,
        confidence: 0.95,
        span: { segmentId: 's1', startMs: 0, endMs: 1000, quote: 'every Friday' },
      });
    }
    const { client, parse } = fakeClient(suggestion());

    expect(await suggestNext(score(state), WINDOW, { client, onUsage: () => {} })).toMatchObject({
      reason: 'nothing-missing',
    });
    expect(parse).not.toHaveBeenCalled();
  });

  it('only ever offers the unconfirmed criteria to the model', async () => {
    const { client, parse } = fakeClient(suggestion({ worth_asking: false }));

    await suggestNext(fresh, WINDOW, { client, onUsage: () => {} });

    const params = parse.mock.calls[0]![0] as unknown as { messages: { content: string }[] };
    expect(params.messages[0]?.content).toContain('pain_quantified');
    expect(params.messages[0]?.content).toContain('s1');
  });

  it('records what the suggestion cost', async () => {
    const events: { tier: string; inputTokens: number }[] = [];
    const { client } = fakeClient(suggestion());

    await suggestNext(fresh, WINDOW, { client, onUsage: (e) => events.push(e) });

    expect(events[0]).toMatchObject({ tier: 't2', inputTokens: 400 });
  });

  it('refuses an empty window', async () => {
    const { client } = fakeClient(suggestion());

    await expect(suggestNext(fresh, [], { client, onUsage: () => {} })).rejects.toThrow(
      /empty window/,
    );
  });
});
