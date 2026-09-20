/**
 * Generate synthetic transcripts for a load run.
 *
 *   pnpm make:transcripts <dir> [--count 50] [--broken 2]
 *
 * This exists for one reason: P4's gate says fifty transcripts in one run with
 * per-file failures, and ten hand-written conversations do not test either
 * claim. What it produces is volume, not quality — the sentences are stitched
 * from a handful of shapes and nobody should measure extraction accuracy on
 * them. The labelled corpus in services/eval is where quality is measured.
 *
 * `--broken` writes files that are deliberately malformed. A run of fifty
 * clean files says nothing about whether one bad file takes the other
 * forty-nine with it, which is the half of the gate that matters.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const COMPANIES = [
  'Halden Freight', 'Marlowe Care', 'Pinehurst Foods', 'Vector Analytics', 'Orchard Bank',
  'Sable Manufacturing', 'Thornbury Retail', 'Kestrel Media', 'Aldridge Legal', 'Brimwater Utilities',
];

const PROBLEMS = [
  ['reconciling the daily takings', 'three hours every morning', 'two people'],
  ['chasing missing timesheets', 'most of Monday', 'a supervisor'],
  ['rebuilding the delivery schedule', 'ninety minutes a day', 'the dispatcher'],
  ['merging the regional reports', 'a full day each month', 'the finance team'],
  ['re-keying supplier invoices', 'about six hours a week', 'two clerks'],
  ['checking compliance paperwork', 'half a day per site visit', 'the auditor'],
];

const REQUESTS = [
  'have it land in Slack when it is ready',
  'let the system suggest the matches and we approve them',
  'see it inside the tool we already use',
  'get a single report both sides agree on',
  'have it redo itself when something changes',
];

const TIMELINES = ['before the end of the quarter', 'by the July renewal', 'once the migration finishes'];

function cue(index: number, speaker: string, text: string): string {
  const start = index * 12;
  const end = start + 10;
  const stamp = (seconds: number) =>
    `00:${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}.000`;
  return `${stamp(start)} --> ${stamp(end)}\n<v ${speaker}>${text}</v>\n`;
}

function transcript(index: number): string {
  const company = COMPANIES[index % COMPANIES.length]!;
  const [task, cost, who] = PROBLEMS[index % PROBLEMS.length]!;
  const request = REQUESTS[index % REQUESTS.length]!;
  const timeline = TIMELINES[index % TIMELINES.length]!;
  const customer = `Customer ${index + 1}`;

  const cues = [
    cue(0, 'Dana Whitfield', `Thanks for the time. How does ${task} work today?`),
    cue(1, customer, `Honestly it is manual. ${task[0]!.toUpperCase()}${task.slice(1)} takes ${cost}.`),
    cue(2, customer, `It ties up ${who}, and mistakes creep in when we are rushing.`),
    cue(3, 'Dana Whitfield', 'What would better look like?'),
    cue(4, customer, `We would want to ${request}.`),
    cue(5, customer, `We are looking at ${timeline}, budget depends on the next planning round.`),
  ];

  return `WEBVTT\n\nNOTE ${company} — synthetic load transcript ${index + 1}\n\n${cues.join('\n')}`;
}

const [directory, ...rest] = process.argv.slice(2);
if (!directory) {
  console.error('usage: pnpm make:transcripts <dir> [--count 50] [--broken 2]');
  process.exit(2);
}

const flag = (name: string, fallback: number): number => {
  const index = rest.indexOf(name);
  return index === -1 ? fallback : Number(rest[index + 1] ?? fallback);
};

const count = flag('--count', 50);
const broken = flag('--broken', 2);

mkdirSync(directory, { recursive: true });

for (let i = 0; i < count - broken; i++) {
  writeFileSync(join(directory, `load-${String(i + 1).padStart(3, '0')}.vtt`), transcript(i), 'utf8');
}

// Two ways a real import breaks: a file that is not the format it claims, and
// one whose timings are impossible. Both must fail alone.
for (let i = 0; i < broken; i++) {
  const name = `load-broken-${i + 1}.vtt`;
  const content =
    i % 2 === 0
      ? 'This file is not WebVTT at all.\nIt is just prose someone renamed.\n'
      : 'WEBVTT\n\n00:00:30.000 --> 00:00:10.000\n<v Customer>Time runs backwards here.</v>\n';
  writeFileSync(join(directory, name), content, 'utf8');
}

console.info(`${count - broken} transcripts and ${broken} deliberately broken files in ${directory}`);
