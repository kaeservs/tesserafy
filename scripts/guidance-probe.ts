/**
 * Does a lesson learned from a correction reach words it was not taught on?
 * For each scenario: a team rule the detector's own reading disagrees with,
 * taught by one correction, then tested on a differently worded sentence —
 * several runs with and without the lesson. Spends a few dozen Haiku calls.
 *
 *   pnpm tsx --env-file-if-exists=.env scripts/guidance-probe.ts [runs]
 */
import Anthropic from '@anthropic-ai/sdk';
import { detectCriteria, type Guidance } from '@tesserafy/ai';

const criteria = [
  {
    key: 'budget_indicated',
    label: 'Budget indicated',
    definition: 'The customer refers to budget, funding, price sensitivity or when money can be committed.',
  },
];

interface Scenario {
  readonly name: string;
  readonly lesson: Guidance;
  /** Said differently from the lesson's quote. */
  readonly test: string;
  /** What the lesson should make the detector do with the test sentence. */
  readonly expect: 'evidence' | 'none';
}

const scenarios: Scenario[] = [
  {
    name: 'approved headcount is budget (teach it to count something)',
    lesson: {
      purpose: 'sales',
      instructions: [],
      examples: [
        {
          criterionKey: 'budget_indicated',
          quote: 'Headcount for this is already approved',
          counts: true,
          reason: 'Approved headcount is budget for us.',
        },
      ],
    },
    test: 'Leadership signed off two new hires to run this project.',
    expect: 'evidence',
  },
  {
    name: 'checking with finance is not budget (teach it to stop counting something)',
    lesson: {
      purpose: 'sales',
      instructions: [],
      examples: [
        {
          criterionKey: 'budget_indicated',
          quote: 'I would need to check with finance first',
          counts: false,
          reason: 'Having to ask finance says nothing about whether money exists.',
        },
      ],
    },
    test: 'Before anything like that I would have to run it past our finance people.',
    expect: 'none',
  },
];

async function main(): Promise<void> {
  const client = new Anthropic();
  const quiet = () => {};
  const runs = Number(process.argv[2] ?? 3);
  for (const scenario of scenarios) {
    const window = [
      { id: 's1', speaker: 'Seller', startMs: 1000, endMs: 5000, text: 'Where are you with this on your side?' },
      { id: 's2', speaker: 'Customer', startMs: 6000, endMs: 10000, text: scenario.test },
    ];
    console.log(`\n${scenario.name} — the lesson should give: ${scenario.expect}`);
    for (const [name, guidance] of [['without the lesson', null], ['with the lesson', scenario.lesson]] as const) {
      const found: string[] = [];
      for (let i = 0; i < runs; i++) {
        const result = await detectCriteria(window, { client, criteria, guidance, onUsage: quiet });
        const budget = result.events.filter((event) => event.criterionKey === 'budget_indicated' && event.kind === 'evidence');
        found.push(budget.length ? `evidence ${Math.max(...budget.map((event) => event.confidence))}` : 'none');
      }
      console.log(`  ${name}: ${found.join(' | ')}`);
    }
  }
}

void main();
