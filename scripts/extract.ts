/**
 * Run T0 + T3 over one transcript and print the result as JSON.
 *
 *   pnpm extract <file.vtt|file.json> [--max-tokens N]
 *
 * No database, no embeddings: this exists so the evaluation harness measures
 * the extractor that ships, rather than a Python copy of its prompt that
 * drifts from it. Segment ids are positional (s0, s1, …) because nothing here
 * is persisted.
 *
 * stdout is JSON and nothing else — progress and usage go to stderr — so the
 * harness can parse it directly.
 */
import { readFileSync } from 'node:fs';
import { extname } from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import { extractSignals, type ExtractableSegment } from '@tesserafy/ai';
import { parseTurns, parseVtt, toSegments, type ParsedTranscript } from '@tesserafy/ingest';

const [file, ...rest] = process.argv.slice(2);
if (!file) {
  console.error('usage: pnpm extract <file.vtt|file.json> [--max-tokens N]');
  process.exit(2);
}

const maxTokensIndex = rest.indexOf('--max-tokens');
const maxTokens = maxTokensIndex === -1 ? undefined : Number(rest[maxTokensIndex + 1]);

function parseFile(path: string): ParsedTranscript {
  const source = readFileSync(path, 'utf8');
  return extname(path).toLowerCase() === '.json' ? parseTurns(JSON.parse(source)) : parseVtt(source);
}

async function main(): Promise<void> {
  const transcript = parseFile(file!);
  const segments: ExtractableSegment[] = toSegments(transcript.turns).map((draft, index) => ({
    id: `s${index}`,
    speaker: draft.speaker,
    startMs: draft.startMs,
    text: draft.text,
  }));

  let usage: unknown = null;
  const result = await extractSignals(segments, {
    client: new Anthropic(),
    ...(maxTokens ? { maxTokens } : {}),
    onUsage: (event) => {
      usage = event;
      console.error(JSON.stringify({ event: 'model.usage', ...event }));
    },
  });

  process.stdout.write(
    `${JSON.stringify(
      {
        title: transcript.title,
        detector: result.detector,
        model: result.model,
        usage,
        segments: segments.map((segment) => ({
          id: segment.id,
          speaker: segment.speaker,
          start_ms: segment.startMs,
          text: segment.text,
        })),
        signals: result.signals.map((signal) => ({
          kind: signal.kind,
          summary: signal.summary,
          confidence: signal.confidence,
          evidence: signal.evidence.map((item) => ({
            segment_id: item.segmentId,
            quote: item.quote,
            quote_start: item.quoteStart,
            quote_end: item.quoteEnd,
          })),
        })),
        // Claims dropped because their quote could not be found verbatim.
        // Tracked as a metric of its own: this is the model paraphrasing.
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
