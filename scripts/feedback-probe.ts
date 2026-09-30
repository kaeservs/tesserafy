/**
 * Does one "Not right" change what the AI writes next time, on words it was
 * not taught on, and leave what it should find alone? Action items: this team
 * tracks only what its own side committed to, so it marks a customer's to-do
 * not right once. A different call then has a customer promising something
 * beside a real commitment from the seller. Several runs with and without the
 * lesson; spends a few Sonnet calls. As with scoring (guidance-probe), the
 * test is only fair where the model's own reading differs from the team's.
 *
 *   pnpm tsx --env-file-if-exists=.env scripts/feedback-probe.ts [runs]
 */
import Anthropic from '@anthropic-ai/sdk';
import { extractActionItems, type Guidance } from '@tesserafy/ai';

const runs = Number(process.argv[2] ?? 3);
const client = new Anthropic();

const lesson: Guidance = {
  purpose: 'sales',
  instructions: [],
  examples: [],
  rejected: [
    {
      result: 'Check with procurement about the contract terms',
      quote: "I'll check with procurement about the terms",
      reason: "We only track what our own side committed to. The customer's own to-dos are not action items for us.",
    },
  ],
};

const call = [
  { id: 's1', speaker: 'Sam (seller)', startMs: 0, text: 'Thanks for walking me through the reporting problem today.' },
  { id: 's2', speaker: 'Dana (customer)', startMs: 6_000, text: 'Happy to. Month-end is still taking us three days.' },
  { id: 's3', speaker: 'Sam (seller)', startMs: 12_000, text: "I'll send over the security questionnaire by Thursday so your IT team can start." },
  { id: 's4', speaker: 'Dana (customer)', startMs: 18_000, text: 'Great. I will loop in our CFO and get back to you next week.' },
  { id: 's5', speaker: 'Sam (seller)', startMs: 24_000, text: 'Perfect, talk soon.' },
];

const theirs = (quote: string) => /CFO|get back to you/i.test(quote);
const ours = (quote: string) => /security questionnaire/i.test(quote);

async function main() {
  for (const [label, guidance] of [
    ['without the lesson', null],
    ['with the lesson', lesson],
  ] as const) {
    let theirsSeen = 0;
    let oursSeen = 0;
    for (let i = 0; i < runs; i++) {
      const result = await extractActionItems(call, { client, ourSpeakers: ['Sam (seller)'], guidance, onUsage: () => {} });
      if (result.items.some((item) => theirs(item.quote))) theirsSeen++;
      if (result.items.some((item) => ours(item.quote))) oursSeen++;
      console.log(`  ${label} #${i + 1}: ${result.items.map((item) => `"${item.action}"`).join(', ') || '(none)'}`);
    }
    console.log(`${label}: the customer's to-do listed ${theirsSeen}/${runs}, the seller's commitment ${oursSeen}/${runs}
`);
  }
}

void main();
