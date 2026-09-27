/**
 * Run T1 criterion detection over one transcript and print JSON.
 *
 *   pnpm detect <file.vtt> --criteria <criteria.json> [--model <id>]
 *               [--stride N [--window W]] [--max-tokens N]
 *
 * Without --stride the whole transcript is one window, which is what spike S3
 * measured. With --stride N it is scored through the product's own path —
 * `windowsOf` at that stride (and --window W utterances, the product's size
 * unless given), every window through T1, deduplicated by `scanWindows` — so a
 * change of windowing can be graded against the same labels before it ships.
 * Usage is then the sum over all the calls. ADR 0014's comparison of the old
 * rolling window (--stride 1 --window 3) with one window per call was made
 * this way.
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
  renderWindow,
  scanWindows,
  systemPrompt,
  windowsOf,
  type CriterionPrompt,
  type DetectableSegment,
} from '@tesserafy/ai';
import { parseTurns, parseVtt, toSegments, type ParsedTranscript } from '@tesserafy/ingest';

const [file, ...rest] = process.argv.slice(2);
if (!file) {
  console.error('usage: pnpm detect <file.vtt> --criteria <criteria.json> [--model <id>] [--compact]');
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
const variant = rest.includes('--compact') ? 'compact' : 'full';
const strideFlag = flag('--stride');
const stride = strideFlag === undefined ? undefined : Number(strideFlag);
// A whole long call has more to say than a three-utterance window; the
// detector's default output cap is sized for the window.
const maxTokensFlag = flag('--max-tokens');
const maxTokens = maxTokensFlag === undefined ? undefined : Number(maxTokensFlag);
const windowFlag = flag('--window');
const windowSize = windowFlag === undefined ? undefined : Number(windowFlag);

function parseFile(path: string): ParsedTranscript {
  const source = readFileSync(path, 'utf8');
  return extname(path).toLowerCase() === '.json' ? parseTurns(JSON.parse(source)) : parseVtt(source);
}

/**
 * Spike S3's local arm. A model id of `ollama:<tag>` goes to a local Ollama
 * instead of the API, using the same system prompt, the same window rendering
 * and the same quote rule, so the two arms differ only in where inference
 * happens.
 *
 * This lives in the spike script rather than in packages/ai on purpose: no
 * product path speaks to a local chat model yet, and a provider abstraction
 * added before the measurement would be a guess about what the answer is.
 */
async function detectWithOllama(
  window: DetectableSegment[],
  criteria: CriterionPrompt[],
  tag: string,
  variant: 'full' | 'compact',
): Promise<{ observations: RawObservation[]; durationMs: number; evalCount: number }> {
  const baseUrl = process.env['OLLAMA_URL'] ?? 'http://127.0.0.1:11434';
  const body = {
    model: tag,
    stream: false,
    options: { temperature: 0 },
    format: {
      type: 'object',
      properties: {
        observations: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              criterion_key: { type: 'string' },
              polarity: { type: 'string', enum: ['supports', 'contradicts'] },
              confidence: { type: 'number' },
              segment_id: { type: 'string' },
              quote: { type: 'string' },
            },
            required: ['criterion_key', 'polarity', 'confidence', 'segment_id', 'quote'],
          },
        },
      },
      required: ['observations'],
    },
    messages: [
      { role: 'system', content: systemPrompt(criteria, variant) },
      { role: 'user', content: renderWindow(window) },
    ],
  };

  const startedAt = Date.now();
  const response = await fetch(new URL('/api/chat', baseUrl), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`Ollama chat failed: ${response.status} ${await response.text()}`);
  }
  const payload = (await response.json()) as {
    message?: { content?: string };
    eval_count?: number;
  };
  const durationMs = Date.now() - startedAt;

  let observations: RawObservation[];
  try {
    observations = (JSON.parse(payload.message?.content ?? '{}') as { observations?: RawObservation[] })
      .observations ?? [];
  } catch {
    // A local model can still emit unparseable JSON despite the schema. That
    // is a result, not a crash: it counts as finding nothing.
    observations = [];
  }

  return { observations, durationMs, evalCount: payload.eval_count ?? 0 };
}

interface RawObservation {
  criterion_key: string;
  polarity: string;
  confidence: number;
  segment_id: string;
  quote: string;
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

  if (model?.startsWith('ollama:')) {
    const tag = model.slice('ollama:'.length);
    const known = new Set(criteria.criteria.map((criterion) => criterion.key));
    const { observations, durationMs, evalCount } = await detectWithOllama(
      window,
      criteria.criteria,
      tag,
      variant,
    );

    const kept: RawObservation[] = [];
    const rejected: { reason: string; summary: string; quote?: string }[] = [];
    for (const observation of observations) {
      const summary = `${observation.criterion_key}: ${observation.quote}`;
      const segment = byId.get(observation.segment_id);
      if (!known.has(observation.criterion_key) || !segment) {
        rejected.push({ reason: 'unknown-segment', summary, quote: observation.quote });
        continue;
      }
      if (!(observation.confidence >= 0 && observation.confidence <= 1)) {
        rejected.push({ reason: 'confidence-out-of-range', summary });
        continue;
      }
      if (!locate(segment.text, observation.quote)) {
        rejected.push({ reason: 'quote-not-found', summary, quote: observation.quote });
        continue;
      }
      kept.push(observation);
    }

    const usage = {
      tier: 't1',
      model: tag,
      inputTokens: 0,
      outputTokens: evalCount,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
      durationMs,
    };
    console.error(JSON.stringify({ event: 'model.usage', ...usage }));

    process.stdout.write(
      `${JSON.stringify(
        {
          engagement_type: criteria.engagement_type,
          criteria_version: criteria.version,
          detector: `t1-detect-local@${tag}`,
          model: tag,
          usage,
          segments: window.map((segment) => ({
            id: segment.id,
            speaker: segment.speaker,
            start_ms: segment.startMs,
            text: segment.text,
          })),
          observations: kept.map((observation) => {
            const segment = byId.get(observation.segment_id)!;
            const span = locate(segment.text, observation.quote)!;
            return {
              criterion_key: observation.criterion_key,
              polarity: observation.polarity === 'contradicts' ? 'contradicts' : 'supports',
              confidence: observation.confidence,
              segment_id: observation.segment_id,
              quote: segment.text.slice(span.start, span.end),
              quote_start: span.start,
              quote_end: span.end,
            };
          }),
          rejected,
        },
        null,
        2,
      )}
`,
    );
    return;
  }

  if (stride !== undefined) {
    const client = new Anthropic();
    const usages: { inputTokens: number; outputTokens: number; cacheCreationInputTokens: number; cacheReadInputTokens: number; durationMs: number }[] = [];
    const scan = await scanWindows(
      windowsOf(
        window.map((segment) => ({
          id: segment.id,
          speaker: segment.speaker,
          start_ms: segment.startMs,
          end_ms: segment.endMs,
          text: segment.text,
        })),
        stride,
        ...(windowSize ? [windowSize] : []),
      ),
      {
        client,
        criteria: criteria.criteria,
        ...(maxTokens ? { maxTokens } : {}),
        onUsage: (event) => {
          usages.push(event);
          console.error(JSON.stringify({ event: 'model.usage', ...event }));
        },
        ...(model ? { detect: (w, o) => detectCriteria(w, { ...o, model }) } : {}),
      },
    );
    const sum = (key: keyof (typeof usages)[number]) => usages.reduce((total, u) => total + u[key], 0);
    const first = scan.events[0];
    process.stdout.write(
      `${JSON.stringify(
        {
          engagement_type: criteria.engagement_type,
          criteria_version: criteria.version,
          detector: first?.detector ?? 'unknown',
          model: first?.model ?? model ?? 'unknown',
          stride,
          calls: scan.calls,
          usage: {
            tier: 't1',
            inputTokens: sum('inputTokens'),
            outputTokens: sum('outputTokens'),
            cacheCreationInputTokens: sum('cacheCreationInputTokens'),
            cacheReadInputTokens: sum('cacheReadInputTokens'),
            durationMs: sum('durationMs'),
          },
          segments: window.map((segment) => ({
            id: segment.id,
            speaker: segment.speaker,
            start_ms: segment.startMs,
            text: segment.text,
          })),
          observations: scan.events.map((event) => {
            const segment = byId.get(event.segmentId)!;
            const span = locate(segment.text, event.quote);
            return {
              criterion_key: event.criterionKey,
              polarity: event.kind === 'contradiction' ? 'contradicts' : 'supports',
              confidence: event.confidence,
              segment_id: event.segmentId,
              quote: event.quote,
              quote_start: span?.start ?? 0,
              quote_end: span?.end ?? 0,
            };
          }),
          rejected: Array.from({ length: scan.rejected }, () => ({ reason: 'rejected' })),
        },
        null,
        2,
      )}\n`,
    );
    return;
  }

  const result = await detectCriteria(window, {
    client: new Anthropic(),
    criteria: criteria.criteria,
    variant,
    ...(model ? { model } : {}),
    ...(maxTokens ? { maxTokens } : {}),
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
