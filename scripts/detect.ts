/**
 * Run T1 criterion detection over one transcript and print JSON.
 *
 *   pnpm detect <file.vtt> --criteria <criteria.json> [--model <id>]
 *
 * Spike S3's measuring stick. Like `pnpm extract` it writes JSON to stdout and
 * nothing else, so the Python harness can drive it.
 *
 * Character offsets are resolved here, next to the segment text, because the
 * harness grades by span overlap and a DetectorEvent carries only the quote.
 */
import { readFileSync } from 'node:fs';
import { extname } from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import {
  detectCriteria,
  locate,
  type CriterionPrompt,
  type DetectableSegment,
} from '@tesserafy/ai';
import { parseTurns, parseVtt, toSegments, type ParsedTranscript } from '@tesserafy/ingest';

const [file, ...rest] = process.argv.slice(2);
if (!file) {
  console.error('usage: pnpm detect <file.vtt> --criteria <criteria.json> [--model <id>]');
  process.exit(2);
}

function flag(name: string): string | undefined {
  const index = rest.indexOf(name);
  return index === -1 ? undefined : rest[index + 1];
}

const criteriaPath = flag('--criteria');
if (!criteriaPath) {
  console.error('detect: --criteria <criteria.json> is required');
  process.exit(2);
}
const model = flag('--model');

function parseFile(path: string): ParsedTranscript {
  const source = readFileSync(path, 'utf8');
  return extname(path).toLowerCase() === '.json' ? parseTurns(JSON.parse(source)) : parseVtt(source);
}

async function main(): Promise<void> {
  const criteria = JSON.parse(readFileSync(criteriaPath!, 'utf8')) as {
    engagement_type: string;
    version: number;
    criteria: CriterionPrompt[];
  };

  const transcript = parseFile(file!);
  const window: DetectableSegment[] = toSegments(transcript.turns).map((draft, index) => ({
    id: `s${index}`,
    speaker: draft.speaker,
    startMs: draft.startMs,
    endMs: draft.endMs,
    text: draft.text,
  }));

  const byId = new Map(window.map((segment) => [segment.id, segment]));

  const result = await detectCriteria(window, {
    client: new Anthropic(),
    criteria: criteria.criteria,
    ...(model ? { model } : {}),
    onUsage: (event) => console.error(JSON.stringify({ event: 'model.usage', ...event })),
  });

  process.stdout.write(
    `${JSON.stringify(
      {
        engagement_type: criteria.engagement_type,
        criteria_version: criteria.version,
        detector: result.detector,
        model: result.model,
        usage: result.usage,
        segments: window.map((segment) => ({
          id: segment.id,
          speaker: segment.speaker,
          start_ms: segment.startMs,
          text: segment.text,
        })),
        observations: result.events.map((event) => {
          const segment = byId.get(event.span.segmentId)!;
          const span = locate(segment.text, event.span.quote);
          return {
            criterion_key: event.criterionKey,
            polarity: event.kind === 'contradiction' ? 'contradicts' : 'supports',
            confidence: event.confidence,
            segment_id: event.span.segmentId,
            quote: event.span.quote,
            quote_start: span?.start ?? 0,
            quote_end: span?.end ?? 0,
          };
        }),
        rejected: result.rejected,
      },
      null,
      2,
    )}\n`,
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
