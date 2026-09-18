/**
 * Ingest one transcript, end to end.
 *
 *   pnpm ingest <file.vtt|file.json> --company <uuid> [options]
 *
 * Transcript -> segments (T0, pure) -> embeddings -> conversation row, then
 * T3 extraction -> signals with verified evidence. Each database write is a
 * single transaction, so an interrupted run leaves either a whole conversation
 * or nothing.
 *
 * This holds the service-role key, which bypasses RLS. It is a server-side
 * operator tool and must never be reachable from the web app.
 */
import { readFileSync } from 'node:fs';
import { extname } from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import {
  createOllamaEmbedder,
  extractSignals,
  toCompanyId,
  writeSignals,
  writeTranscript,
  type ExtractableSegment,
} from '@tesserafy/ai';
import { createServiceClient } from '@tesserafy/db';
import { parseTurns, parseVtt, toSegments, type ParsedTranscript } from '@tesserafy/ingest';

interface Args {
  file: string;
  company: string;
  title: string | null;
  occurredAt: string | null;
  dryRun: boolean;
  extract: boolean;
  json: boolean;
}

function parseArgs(argv: readonly string[]): Args {
  const [file, ...rest] = argv;
  if (!file || file.startsWith('--')) usage('a transcript file is required');

  const args: Args = {
    file,
    company: '',
    title: null,
    occurredAt: null,
    dryRun: false,
    extract: true,
    json: false,
  };

  for (let i = 0; i < rest.length; i++) {
    const flag = rest[i];
    switch (flag) {
      case '--company':
        args.company = rest[++i] ?? usage('--company needs a company id');
        break;
      case '--title':
        args.title = rest[++i] ?? usage('--title needs a value');
        break;
      case '--occurred-at':
        args.occurredAt = rest[++i] ?? usage('--occurred-at needs an ISO 8601 timestamp');
        break;
      case '--dry-run':
        args.dryRun = true;
        break;
      case '--no-extract':
        args.extract = false;
        break;
      case '--json':
        args.json = true;
        break;
      default:
        usage(`unknown option ${flag}`);
    }
  }

  if (!args.dryRun && args.company.length === 0) usage('--company is required');
  return args;
}

function usage(message: string): never {
  console.error(`ingest: ${message}

Usage:
  pnpm ingest <file.vtt|file.json> --company <uuid> [options]

Options:
  --company <uuid>      The tenant the conversation belongs to. Required.
  --title <text>        Defaults to the transcript's own title, else the filename.
  --occurred-at <iso>   When the call happened.
  --dry-run             Parse and chunk only. Writes nothing, calls nothing.
  --json                With --dry-run, print the segments as JSON. The eval
                        harness reads this to validate a corpus offline.
  --no-extract          Write the transcript but skip T3 extraction.

Environment:
  SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   required unless --dry-run
  ANTHROPIC_API_KEY                         required unless --no-extract
  OLLAMA_URL      default http://127.0.0.1:11434
  EMBED_MODEL     default nomic-embed-text`);
  process.exit(2);
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    console.error(`ingest: ${name} is not set`);
    process.exit(2);
  }
  return value;
}

function parseFile(path: string): ParsedTranscript {
  const source = readFileSync(path, 'utf8');
  // The extension only chooses a parser; both validate what they are given.
  return extname(path).toLowerCase() === '.json' ? parseTurns(JSON.parse(source)) : parseVtt(source);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const transcript = parseFile(args.file);
  const segments = toSegments(transcript.turns);
  const title = args.title ?? transcript.title ?? args.file;

  if (args.dryRun && args.json) {
    // Ids match scripts/extract.ts, so a label resolved here resolves there.
    process.stdout.write(
      `${JSON.stringify(
        {
          title: transcript.title,
          segments: segments.map((segment) => ({
            id: `s${segment.index}`,
            speaker: segment.speaker,
            start_ms: segment.startMs,
            text: segment.text,
          })),
        },
        null,
        2,
      )}
`,
    );
    return;
  }

  console.info(
    `Parsed ${transcript.turns.length} turns into ${segments.length} segments — "${title}"`,
  );

  if (args.dryRun) {
    for (const segment of segments.slice(0, 5)) {
      console.info(`  [${segment.index}] ${segment.speaker ?? 'unknown'}: ${segment.text}`);
    }
    if (segments.length > 5) console.info(`  … ${segments.length - 5} more`);
    return;
  }

  const companyId = toCompanyId(args.company);
  const db = createServiceClient({
    url: requireEnv('SUPABASE_URL'),
    key: requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
  });
  const embedder = createOllamaEmbedder({
    baseUrl: process.env['OLLAMA_URL'] ?? 'http://127.0.0.1:11434',
    model: process.env['EMBED_MODEL'] ?? 'nomic-embed-text',
  });

  const written = await writeTranscript(
    companyId,
    { title, occurredAt: args.occurredAt, segments },
    { db, embedder },
  );
  console.info(
    `Wrote conversation ${written.conversationId} with ${written.segmentCount} segments`,
  );

  if (!args.extract) return;
  requireEnv('ANTHROPIC_API_KEY');

  // The extractor cites segments by id, so it has to read back what was
  // written rather than work from the drafts.
  const { data, error } = await db
    .from('segments')
    .select('id, speaker, start_ms, text')
    .eq('company_id', companyId)
    .eq('conversation_id', written.conversationId)
    .order('start_ms', { ascending: true });

  if (error) throw new Error(`Reading back segments failed: ${error.message}`, { cause: error });

  const rows = (data ?? []) as { id: string; speaker: string | null; start_ms: number; text: string }[];
  const extractable: ExtractableSegment[] = rows.map((row) => ({
    id: row.id,
    speaker: row.speaker,
    startMs: row.start_ms,
    text: row.text,
  }));

  const extraction = await extractSignals(extractable, { client: new Anthropic() });
  const ids = await writeSignals(
    companyId,
    {
      conversationId: written.conversationId,
      detector: extraction.detector,
      model: extraction.model,
      signals: extraction.signals,
    },
    { db },
  );

  console.info(`Stored ${ids.length} signals`);
  if (extraction.rejected.length > 0) {
    // Worth seeing every time: a rising count here means the prompt is
    // drifting towards paraphrase, which is the failure this pipeline exists
    // to catch.
    console.warn(`Rejected ${extraction.rejected.length} claim(s) the model could not support:`);
    for (const rejection of extraction.rejected) {
      console.warn(`  ${rejection.reason}: ${rejection.summary}`);
    }
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
