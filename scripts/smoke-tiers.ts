/**
 * Can every tier still talk to its model?
 *
 *   pnpm smoke:tiers
 *
 * Four of the smallest real calls the product makes, one per tier, through the
 * tier functions themselves rather than through a hand-written request. Only
 * the pass or fail matters; what the model says is not graded here.
 *
 * This exists because of a specific failure. Pinning `temperature: 0` across
 * every tier was measured on T1, where the model accepts it, and shipped to
 * T2 and T3, where `claude-sonnet-5` and `claude-opus-5` deprecate the
 * parameter and reject the whole request. `/api/suggest`, extraction and
 * synthesis were down for four merges.
 *
 * Nothing in the unit suite could have caught it. Every one of those tests
 * fakes the client, which is right — they are about what the product does
 * with an answer, and a test that spends money to assert a schema is a test
 * nobody runs. But it means the request shape itself is asserted by nothing,
 * and the request shape is shared: a change to it is not a change to the tier
 * that prompted it.
 *
 * So this calls the real API and grades one thing: whether the request this
 * tier sends is a request its model accepts. Seconds, and a few cents.
 */
import Anthropic from '@anthropic-ai/sdk';
import {
  detectCriteria,
  extractSignals,
  suggestNext,
  synthesiseInsight,
  T1_MODEL,
  T2_MODEL,
  T3_MODEL,
} from '@tesserafy/ai';
import { defineCriteriaSet, initialState, score } from '@tesserafy/scoring';

const CRITERIA = defineCriteriaSet({
  engagementType: 'smoke',
  version: 1,
  criteria: [{ key: 'pain_quantified', label: 'Pain quantified', weight: 1 }],
});

const PROMPTS = [
  {
    key: 'pain_quantified',
    label: 'Pain quantified',
    definition: 'The customer states what a problem costs them in time or money.',
  },
];

const SEGMENT = {
  id: 's1',
  speaker: 'customer',
  startMs: 0,
  endMs: 5000,
  text: 'Exporting the weekly report takes us most of Friday afternoon.',
};

/** Three signals from three conversations: the least a cluster may be. */
const SIGNALS = ['c1', 'c2', 'c3'].map((conversationId, index) => ({
  id: `g${index + 1}`,
  conversationId,
  kind: 'problem',
  summary: 'Exporting the weekly report is slow',
  quote: SEGMENT.text,
}));

interface Outcome {
  tier: string;
  model: string;
  ok: boolean;
  detail: string;
}

async function attempt(tier: string, model: string, run: () => Promise<unknown>): Promise<Outcome> {
  const startedAt = Date.now();
  try {
    await run();
    return { tier, model, ok: true, detail: `${Date.now() - startedAt} ms` };
  } catch (error) {
    // The message is the point: "deprecated for this model" is the exact
    // sentence that went unseen for four merges.
    return {
      tier,
      model,
      ok: false,
      detail: error instanceof Error ? error.message.split('\n')[0]! : String(error),
    };
  }
}

async function main(): Promise<void> {
  if (!process.env['ANTHROPIC_API_KEY']) {
    console.error('smoke:tiers: ANTHROPIC_API_KEY is not set');
    process.exit(2);
  }

  const client = new Anthropic();
  const quiet = () => {};

  const outcomes: Outcome[] = [];

  outcomes.push(
    await attempt('T1 detect', T1_MODEL, () =>
      detectCriteria([SEGMENT], { client, criteria: PROMPTS, onUsage: quiet }),
    ),
  );

  outcomes.push(
    await attempt('T2 suggest', T2_MODEL, () =>
      suggestNext(score(initialState(CRITERIA)), [SEGMENT], { client, onUsage: quiet }),
    ),
  );

  outcomes.push(
    await attempt('T3 extract', T3_MODEL, () =>
      extractSignals([SEGMENT], { client, onUsage: quiet }),
    ),
  );

  outcomes.push(
    await attempt('T3 synthesise', T3_MODEL, () =>
      synthesiseInsight(
        { seed: SIGNALS[0]!, signals: SIGNALS, conversationIds: ['c1', 'c2', 'c3'] },
        { client, onUsage: quiet },
      ),
    ),
  );

  for (const outcome of outcomes) {
    console.info(
      `${outcome.ok ? '  ok  ' : ' FAIL '} ${outcome.tier.padEnd(15)} ${outcome.model.padEnd(18)} ${outcome.detail}`,
    );
  }

  const failed = outcomes.filter((outcome) => !outcome.ok);
  console.info(`\n${outcomes.length - failed.length}/${outcomes.length} tiers reachable`);
  if (failed.length > 0) process.exit(1);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
