/**
 * What happens to a call after it ends.
 *
 *   pnpm process --conversation <uuid>          embed, then extract signals
 *   pnpm process --company <uuid>               every conversation missing either
 *   pnpm process --conversation <uuid> --dry-run  say what it would do, spend nothing
 *   pnpm process --conversation <uuid> --embed-only
 *
 * `pnpm ingest` does this as part of importing a file. A live call never went
 * through it: its segments arrived one at a time while somebody was talking,
 * so nothing embedded them and nothing extracted from them. The effect was
 * quiet and total — a live call scored, appeared on the dashboard, and could
 * never become an insight, because insights are clustered from signals
 * through a vector search and it had neither.
 *
 * Deliberately not automatic. T3 is Opus and an insight is a claim about a
 * customer; spending that, and making that, without a person asking is what
 * "no auto-creation anywhere" rules out. It prints the bill first and
 * --dry-run pays none of it.
 */
import Anthropic from '@anthropic-ai/sdk';
import {
  both,
  createOllamaEmbedder,
  databaseSink,
  embedStoredSegments,
  extractSignals,
  logUsage,
  pendingEmbeddings,
  toCompanyId,
  writeSignals,
  T3_DETECTOR,
  type ExtractableSegment,
} from '@tesserafy/ai';
import { createServiceClient, type SupabaseClient } from '@tesserafy/db';

function flag(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`process: ${name} is not set`);
    process.exit(2);
  }
  return value;
}

interface ConversationRow {
  id: string;
  company_id: string;
  title: string;
}

/** Conversations with no signals yet — the ones extraction has never seen. */
async function unextracted(
  db: SupabaseClient,
  conversations: readonly ConversationRow[],
): Promise<Set<string>> {
  if (conversations.length === 0) return new Set();

  const { data, error } = await db
    .from('signals')
    .select('conversation_id')
    .in('conversation_id', conversations.map((row) => row.id));
  if (error) throw new Error(`Reading signals failed: ${error.message}`);

  const has = new Set(((data ?? []) as { conversation_id: string }[]).map((r) => r.conversation_id));
  return new Set(conversations.filter((row) => !has.has(row.id)).map((row) => row.id));
}

async function main(): Promise<void> {
  const conversationId = flag('--conversation');
  const companyFlag = flag('--company');
  const dryRun = process.argv.includes('--dry-run');
  const embedOnly = process.argv.includes('--embed-only');

  if (!conversationId && !companyFlag) {
    console.error(
      'usage: pnpm process --conversation <uuid> | --company <uuid> [--dry-run] [--embed-only]',
    );
    process.exit(2);
  }

  const db = createServiceClient({
    url: requireEnv('SUPABASE_URL'),
    key: requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
  });

  let query = db.from('conversations').select('id, company_id, title').order('occurred_at');
  if (conversationId) query = query.eq('id', conversationId);
  if (companyFlag) query = query.eq('company_id', companyFlag);

  const { data, error } = await query;
  if (error) throw new Error(`Listing conversations failed: ${error.message}`);
  const conversations = (data ?? []) as ConversationRow[];

  if (conversations.length === 0) {
    console.info('No conversations matched.');
    return;
  }

  const needsExtraction = embedOnly ? new Set<string>() : await unextracted(db, conversations);

  // The whole plan before any of it is paid for: how many vectors, how many
  // extractions. Embedding is local and free; extraction is Opus and is not.
  const plan: { conversation: ConversationRow; pending: number; extract: boolean }[] = [];
  for (const conversation of conversations) {
    const companyId = toCompanyId(conversation.company_id);
    const pending = await pendingEmbeddings(companyId, { db, conversationId: conversation.id });
    const extract = needsExtraction.has(conversation.id);
    if (pending.length === 0 && !extract) continue;
    plan.push({ conversation, pending: pending.length, extract });
  }

  if (plan.length === 0) {
    console.info('Nothing to do: everything is embedded and extracted.');
    return;
  }

  const vectors = plan.reduce((sum, entry) => sum + entry.pending, 0);
  const extractions = plan.filter((entry) => entry.extract).length;
  console.info(
    `${plan.length} conversation(s): ${vectors} segment(s) to embed locally, ` +
      `${extractions} T3 extraction(s) on Opus.`,
  );
  for (const entry of plan) {
    console.info(
      `  ${entry.conversation.title} — ${entry.pending} to embed` +
        (entry.extract ? ', extraction pending' : ''),
    );
  }

  if (dryRun) {
    console.info('\n--dry-run: nothing embedded, nothing sent, nothing written.');
    return;
  }

  const embedder = createOllamaEmbedder({
    baseUrl: process.env['OLLAMA_URL'] ?? 'http://127.0.0.1:11434',
    model: process.env['EMBED_MODEL'] ?? 'nomic-embed-text',
  });
  if (extractions > 0) requireEnv('ANTHROPIC_API_KEY');

  for (const entry of plan) {
    const companyId = toCompanyId(entry.conversation.company_id);

    if (entry.pending > 0) {
      const segments = await pendingEmbeddings(companyId, {
        db,
        conversationId: entry.conversation.id,
      });
      const result = await embedStoredSegments(companyId, segments, { db, embedder });
      console.info(
        `${entry.conversation.title}: embedded ${result.embedded} segment(s)` +
          (result.skipped > 0 ? `, ${result.skipped} skipped` : ''),
      );
    }

    if (!entry.extract) continue;

    // Read back rather than reuse the pending list: extraction cites segments
    // by id across the whole conversation, not only the ones that happened to
    // be missing a vector.
    const { data: rows, error: readError } = await db
      .from('segments')
      .select('id, speaker, start_ms, text')
      .eq('conversation_id', entry.conversation.id)
      .order('start_ms', { ascending: true });
    if (readError) throw new Error(`Reading segments failed: ${readError.message}`);

    const extractable: ExtractableSegment[] = ((rows ?? []) as {
      id: string;
      speaker: string | null;
      start_ms: number;
      text: string;
    }[]).map((row) => ({
      id: row.id,
      speaker: row.speaker,
      startMs: row.start_ms,
      text: row.text,
    }));

    if (extractable.length === 0) continue;

    const extraction = await extractSignals(extractable, {
      client: new Anthropic(),
      onUsage: both(
        logUsage,
        databaseSink({
          db,
          companyId,
          conversationId: entry.conversation.id,
          detector: T3_DETECTOR,
        }),
      ),
    });

    const ids = await writeSignals(
      companyId,
      {
        conversationId: entry.conversation.id,
        detector: extraction.detector,
        model: extraction.model,
        signals: extraction.signals,
      },
      { db },
    );

    console.info(`${entry.conversation.title}: stored ${ids.length} signal(s)`);
    if (extraction.rejected.length > 0) {
      // Worth seeing every time: a rising count means the prompt is drifting
      // towards paraphrase, which is the failure this pipeline exists to catch.
      console.warn(`  rejected ${extraction.rejected.length} claim(s) it could not support:`);
      for (const rejection of extraction.rejected) {
        console.warn(`    ${rejection.reason}: ${rejection.summary}`);
      }
    }
  }

  console.info('\nRun `pnpm insights --company <uuid>` to see what these say together.');
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
