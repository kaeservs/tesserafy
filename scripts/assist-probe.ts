/**
 * How fast, and how faithful, is the overlay's on-demand help on each model?
 * The same call, each mode, a few runs per model: the time to answer, the
 * points given, and how many were dropped for quoting what the call did not
 * say. T2 runs on claude-sonnet-5 with a 3.5 s budget (CLAUDE.md); Cluely's
 * whole pitch is speed, so this is what decides the model, not a guess.
 *
 *   pnpm tsx --env-file-if-exists=.env scripts/assist-probe.ts [runs]
 */
import Anthropic from '@anthropic-ai/sdk';
import { assist, type AssistMode } from '@tesserafy/ai';

const runs = Number(process.argv[2] ?? 3);
const client = new Anthropic();
const MODELS = ['claude-sonnet-5', 'claude-haiku-4-5'];
const MODES: AssistMode[] = ['say', 'followups', 'recap'];

const transcript = [
  { id: 'u0', speaker: 'Dana', text: 'Month-end close still takes us three days, and finance is exhausted by it.' },
  { id: 'u1', speaker: 'Seller', text: 'What have you tried so far?' },
  { id: 'u2', speaker: 'Dana', text: 'We tried spreadsheets and a consultant, but nothing stuck.' },
  { id: 'u3', speaker: 'Seller', text: 'Who else would be involved in choosing something new?' },
  { id: 'u4', speaker: 'Dana', text: 'Our CFO signs off anything over twenty thousand. How long does rollout usually take?' },
];
const brief = 'Call with Dana Whitfield at Acme Robotics.\nOpen with: Ask how month-end went.\nTo ask: What budget have you set aside?';

async function main() {
  for (const model of MODELS) {
    for (const mode of MODES) {
      const times: number[] = [];
      let points = 0;
      let dropped = 0;
      let sample = '';
      for (let i = 0; i < runs; i++) {
        const t0 = Date.now();
        const result = await assist({ mode, transcript, brief }, { client, model, onUsage: () => {} });
        times.push(Date.now() - t0);
        points += result.points.length;
        dropped += result.dropped;
        sample = result.points.map((point) => point.text).join(' | ');
      }
      times.sort((a, b) => a - b);
      console.log(
        `${model.padEnd(18)} ${mode.padEnd(10)} median ${String(times[Math.floor(times.length / 2)]).padStart(5)} ms, ` +
          `max ${String(times[times.length - 1]).padStart(5)} ms · ${points} points, ${dropped} dropped · e.g. ${sample.slice(0, 110)}`,
      );
    }
  }
}

void main();
