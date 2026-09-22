/**
 * Import a directory of transcripts in one run.
 *
 *   pnpm ingest:batch <dir> --company <uuid> [options]
 *
 * Three properties the P4 gate asks for, and what each costs:
 *
 *   Failures are per file. One malformed transcript, one model refusal or one
 *   network blip must not abandon the other forty-nine. Every file is caught
 *   individually and the run continues; the exit code is non-zero if any
 *   failed, so a script above this still knows.
 *
 *   Cost is recorded per transcript. Tokens, duration, segment and signal
 *   counts, per file, written to a report. Cost telemetry cannot be
 *   reconstructed later, and "what did importing this customer cost" is the
 *   question a pricing model is built from.
 *
 *   Re-running is safe. Each file carries a source key, unique per company in
 *   the database. A file already imported is skipped before it is embedded,
 *   because embedding a duplicate costs exactly as much as embedding a new
 *   one.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join, relative, resolve } from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import {
  both,
  conversationForSource,
  createOllamaEmbedder,
  databaseSink,
  DuplicateSource,
  extractSignals,
  T3_DETECTOR,
  toCompanyId,
  writeSignals,
  writeTranscript,
  type CompanyId,
  type ExtractableSegment,
} from '@tesserafy/ai';
import { createServiceClient } from '@tesserafy/db';
import { parseTurns, parseVtt, toSegments, type ParsedTranscript } from '@tesserafy/ingest';
import type { SupabaseClient } from '@tesserafy/db';

const TRANSCRIPT_EXTENSIONS = new Set(['.vtt', '.json']);

interface Args {
  directory: string;
  company: string;
  concurrency: number;
  extract: boolean;
  limit: number | null;
  report: string | null;
}

interface FileOutcome {
  file: string;
  status: 'imported' | 'skipped' | 'failed';
  conversationId?: string;
  segments?: number;
  signals?: number;
  rejected?: number;
  inputTokens?: number;
  outputTokens?: number;
  durationMs?: number;
  error?: string;
}

function parseArgs(argv: readonly string[]): Args {
  const [directory, ...rest] = argv;
  if (!directory || directory.startsWith('--')) usage('a directory is required');

  const args: Args = {
    directory,
    company: '',
    concurrency: 2,
    extract: true,
    limit: null,
    report: null,
  };

  for (let i = 0; i < rest.length; i++) {
    switch (rest[i]) {
      case '--company':
        args.company = rest[++i] ?? usage('--company needs a company id');
        break;
      case '--concurrency':
        args.concurrency = Number(rest[++i] ?? usage('--concurrency needs a number'));
        break;
      case '--limit':
        args.limit = Number(rest[++i] ?? usage('--limit needs a number'));
        break;
      case '--report':
        args.report = rest[++i] ?? usage('--report needs a path');
        break;
      case '--no-extract':
        args.extract = false;
        break;
      default:
        usage(`unknown option ${rest[i]}`);
    }
  }

  if (!args.company) usage('--company is required');
  if (!Number.isInteger(args.concurrency) || args.concurrency < 1 || args.concurrency > 8) {
    usage('--concurrency must be an integer from 1 to 8');
  }
  return args;
}

function usage(message: string): never {
  console.error(`ingest:batch: ${message}

Usage:
  pnpm ingest:batch <dir> --company <uuid> [options]

Options:
  --company <uuid>       The tenant every conversation belongs to. Required.
  --concurrency <n>      Files in flight at once, 1-8. Default 2.
  --limit <n>            Import at most n files.
  --report <path>        Write the per-file report here as JSON.
  --no-extract           Write transcripts but skip T3 extraction.

Environment:
  SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   required
  ANTHROPIC_API_KEY                         required unless --no-extract
  OLLAMA_URL      default http://127.0.0.1:11434
  EMBED_MODEL     default nomic-embed-text`);
  process.exit(2);
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    console.error(`ingest:batch: ${name} is not set`);
    process.exit(2);
  }
  return value;
}

/** Every transcript under the directory, deepest last, in a stable order. */
function findTranscripts(root: string): string[] {
  const found: string[] = [];
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory).sort()) {
      const path = join(directory, entry);
      if (statSync(path).isDirectory()) walk(path);
      else if (TRANSCRIPT_EXTENSIONS.has(extname(entry).toLowerCase())) found.push(path);
    }
  };
  walk(root);
  return found;
}

function parseFile(path: string): ParsedTranscript {
  const source = readFileSync(path, 'utf8');
  return extname(path).toLowerCase() === '.json' ? parseTurns(JSON.parse(source)) : parseVtt(source);
}

async function importOne(
  path: string,
  sourceKey: string,
  companyId: CompanyId,
  db: SupabaseClient,
  args: Args,
): Promise<FileOutcome> {
  const startedAt = Date.now();

  const existing = await conversationForSource(companyId, sourceKey, { db });
  if (existing) {
    return { file: sourceKey, status: 'skipped', conversationId: existing };
  }

  const transcript = parseFile(path);
  const segments = toSegments(transcript.turns);
  const embedder = createOllamaEmbedder({
    baseUrl: process.env['OLLAMA_URL'] ?? 'http://127.0.0.1:11434',
    model: process.env['EMBED_MODEL'] ?? 'nomic-embed-text',
  });

  const written = await writeTranscript(
    companyId,
    {
      title: transcript.title ?? sourceKey,
      occurredAt: null,
      sourceKey,
      segments,
    },
    { db, embedder },
  );

  const outcome: FileOutcome = {
    file: sourceKey,
    status: 'imported',
    conversationId: written.conversationId,
    segments: written.segmentCount,
    signals: 0,
    rejected: 0,
    inputTokens: 0,
    outputTokens: 0,
  };

  if (args.extract) {
    const { data, error } = await db
      .from('segments')
      .select('id, speaker, start_ms, text')
      .eq('company_id', companyId)
      .eq('conversation_id', written.conversationId)
      .order('start_ms', { ascending: true });
    if (error) throw new Error(`Reading back segments failed: ${error.message}`, { cause: error });

    const rows = (data ?? []) as {
      id: string;
      speaker: string | null;
      start_ms: number;
      text: string;
    }[];
    const extractable: ExtractableSegment[] = rows.map((row) => ({
      id: row.id,
      speaker: row.speaker,
      startMs: row.start_ms,
      text: row.text,
    }));

    const extraction = await extractSignals(extractable, {
      client: new Anthropic(),
      onUsage: both(
        (usage) => {
          outcome.inputTokens = usage.inputTokens;
          outcome.outputTokens = usage.outputTokens;
        },
        databaseSink({
          db,
          companyId,
          conversationId: written.conversationId,
          detector: T3_DETECTOR,
        }),
      ),
    });

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
    outcome.signals = ids.length;
    outcome.rejected = extraction.rejected.length;
  }

  return { ...outcome, durationMs: Date.now() - startedAt };
}

/** A fixed pool: the workers share one cursor over the file list. */
async function runPool(
  files: readonly { path: string; key: string }[],
  concurrency: number,
  work: (file: { path: string; key: string }) => Promise<FileOutcome>,
): Promise<FileOutcome[]> {
  const outcomes: FileOutcome[] = new Array(files.length);
  let cursor = 0;

  const worker = async (): Promise<void> => {
    for (;;) {
      const index = cursor++;
      const file = files[index];
      if (!file) return;

      try {
        outcomes[index] = await work(file);
      } catch (error) {
        // One file's failure is one file's failure. It is recorded with its
        // reason and the run carries on.
        outcomes[index] = {
          file: file.key,
          status: error instanceof DuplicateSource ? 'skipped' : 'failed',
          ...(error instanceof DuplicateSource
            ? {}
            : { error: error instanceof Error ? error.message : String(error) }),
        };
      }

      const done = outcomes[index]!;
      const label =
        done.status === 'imported'
          ? `${done.segments} segments, ${done.signals} signals`
          : (done.error ?? 'already imported');
      console.info(`[${index + 1}/${files.length}] ${done.status.padEnd(8)} ${done.file} — ${label}`);
    }
  };

  await Promise.all(Array.from({ length: concurrency }, worker));
  return outcomes;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const root = resolve(args.directory);
  const companyId = toCompanyId(args.company);

  const paths = findTranscripts(root);
  const files = (args.limit ? paths.slice(0, args.limit) : paths).map((path) => ({
    path,
    // The key is the path relative to the directory being imported, so the
    // same corpus imported from another machine skips rather than duplicates.
    key: relative(root, path).split('\\').join('/'),
  }));

  if (files.length === 0) {
    console.error(`ingest:batch: no .vtt or .json transcripts under ${root}`);
    process.exit(1);
  }

  const db = createServiceClient({
    url: requireEnv('SUPABASE_URL'),
    key: requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
  });
  if (args.extract) requireEnv('ANTHROPIC_API_KEY');

  console.info(`Importing ${files.length} transcript(s) with concurrency ${args.concurrency}\n`);
  const startedAt = Date.now();
  const outcomes = await runPool(files, args.concurrency, (file) =>
    importOne(file.path, file.key, companyId, db, args),
  );

  const imported = outcomes.filter((o) => o.status === 'imported');
  const skipped = outcomes.filter((o) => o.status === 'skipped');
  const failed = outcomes.filter((o) => o.status === 'failed');
  const inputTokens = imported.reduce((sum, o) => sum + (o.inputTokens ?? 0), 0);
  const outputTokens = imported.reduce((sum, o) => sum + (o.outputTokens ?? 0), 0);

  const report = {
    finished_at: new Date().toISOString(),
    directory: root,
    company_id: companyId,
    wall_clock_ms: Date.now() - startedAt,
    imported: imported.length,
    skipped: skipped.length,
    failed: failed.length,
    tokens: { input: inputTokens, output: outputTokens },
    files: outcomes,
  };

  console.info(
    `\n${imported.length} imported · ${skipped.length} skipped · ${failed.length} failed` +
      ` · ${Math.round(report.wall_clock_ms / 1000)}s`,
  );
  console.info(`tokens ${inputTokens} in / ${outputTokens} out`);
  if (imported.length > 0) {
    console.info(
      `per transcript: ${Math.round(inputTokens / imported.length)} in / ` +
        `${Math.round(outputTokens / imported.length)} out`,
    );
  }

  if (failed.length > 0) {
    console.error('\nFailures:');
    for (const failure of failed) console.error(`  ${failure.file}: ${failure.error}`);
  }

  if (args.report) {
    const { writeFileSync } = await import('node:fs');
    writeFileSync(args.report, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    console.info(`\nreport written to ${args.report}`);
  }

  // A partial import is not a success, and a caller scripting this needs to
  // know without parsing the output.
  if (failed.length > 0) process.exit(1);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
