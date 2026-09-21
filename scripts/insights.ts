/**
 * Find what several conversations say together.
 *
 *   pnpm insights --company <uuid> [--dry-run] [--min-signals 3]
 *
 * Loads a company's signals, clusters them through the guarded retrieval path,
 * asks T3 whether each cluster is one finding, and writes those that are.
 *
 * --dry-run clusters and prints without calling a model or writing anything,
 * which is how you check whether a corpus has enough overlap to be worth
 * spending on.
 */
import Anthropic from '@anthropic-ai/sdk';
import {
  both,
  clusterSignals,
  createOllamaEmbedder,
  databaseSink,
  loadSignals,
  logUsage,
  synthesiseInsight,
  toCompanyId,
  writeInsight,
} from '@tesserafy/ai';
import { createServiceClient } from '@tesserafy/db';

interface Args {
  company: string;
  dryRun: boolean;
  write: boolean;
  minSignals: number;
  minConversations: number;
}

function parseArgs(argv: readonly string[]): Args {
  const args: Args = { company: '', dryRun: false, write: true, minSignals: 3, minConversations: 2 };

  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case '--company':
        args.company = argv[++i] ?? usage('--company needs a company id');
        break;
      case '--min-signals':
        args.minSignals = Number(argv[++i] ?? usage('--min-signals needs a number'));
        break;
      case '--min-conversations':
        args.minConversations = Number(argv[++i] ?? usage('--min-conversations needs a number'));
        break;
      case '--dry-run':
        args.dryRun = true;
        break;
      case '--no-write':
        args.write = false;
        break;
      default:
        usage(`unknown option ${argv[i]}`);
    }
  }

  if (!args.company) usage('--company is required');
  return args;
}

function usage(message: string): never {
  console.error(`insights: ${message}

Usage:
  pnpm insights --company <uuid> [options]

Options:
  --company <uuid>          The tenant to draw insights for. Required.
  --dry-run                 Cluster and print. No model, no writes.
  --no-write                Synthesise and print, but write nothing. For
                            reviewing what an insight would say before it
                            lands in front of anyone.
  --min-signals <n>         Signals a cluster needs. Default 3.
  --min-conversations <n>   Conversations it must span. Default 2.

Environment:
  SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   required
  ANTHROPIC_API_KEY                         required unless --dry-run
  OLLAMA_URL      default http://127.0.0.1:11434
  EMBED_MODEL     default nomic-embed-text`);
  process.exit(2);
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    console.error(`insights: ${name} is not set`);
    process.exit(2);
  }
  return value;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const companyId = toCompanyId(args.company);

  const db = createServiceClient({
    url: requireEnv('SUPABASE_URL'),
    key: requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
  });
  const embedder = createOllamaEmbedder({
    baseUrl: process.env['OLLAMA_URL'] ?? 'http://127.0.0.1:11434',
    model: process.env['EMBED_MODEL'] ?? 'nomic-embed-text',
  });

  const signals = await loadSignals(companyId, db);
  console.info(`${signals.length} signal(s) across ${new Set(signals.map((s) => s.conversationId)).size} conversation(s)`);
  if (signals.length === 0) return;

  const clusters = await clusterSignals(companyId, signals, {
    db,
    embedder,
    minSignals: args.minSignals,
    minConversations: args.minConversations,
  });
  console.info(`${clusters.length} candidate cluster(s)\n`);

  for (const cluster of clusters) {
    console.info(
      `cluster of ${cluster.signals.length} ${cluster.seed.kind}(s) across ` +
        `${cluster.conversationIds.length} conversation(s):`,
    );
    for (const signal of cluster.signals) console.info(`  - ${signal.summary}`);
    console.info('');
  }

  if (args.dryRun || clusters.length === 0) return;
  requireEnv('ANTHROPIC_API_KEY');

  const client = new Anthropic();
  let written = 0;

  for (const cluster of clusters) {
    const result = await synthesiseInsight(cluster, {
      client,
      minSignals: args.minSignals,
      minConversations: args.minConversations,
      onUsage: both(
        logUsage,
        databaseSink({ db, companyId, detector: 't3-synthesise' }),
      ),
    });

    if ('reason' in result) {
      // Declining is a result, not a failure: the cluster was similar words,
      // not one finding.
      console.info(`skipped (${result.reason}): ${result.note}`);
      continue;
    }

    const id = args.write ? await writeInsight(companyId, result, { db }) : '(not written)';
    if (args.write) written += 1;
    console.info(`\n${result.title}`);
    console.info(`  ${result.summary}`);
    console.info(
      `  ${result.signalIds.length} signals · ${result.conversationIds.length} conversations · ${id}`,
    );
  }

  console.info(`\n${written} insight(s) written`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
