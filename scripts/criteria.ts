/**
 * Criteria sets, which are data.
 *
 *   pnpm criteria --list
 *   pnpm criteria --add <file.json>
 *   pnpm criteria --add <file.json> --dry-run
 *   pnpm criteria --show <engagement-type> [--version <n>]
 *   pnpm criteria --try <file.json> --conversation <uuid>
 *
 * "A new engagement type is a row" has been the stated convention since the
 * table was written, and until now there was no way to write the row. The
 * only set that existed was the one shipped in its migration, and every live
 * surface hardcoded its name — a convention true in the schema and false in
 * practice.
 *
 * An operator script rather than a migration, which the criteria migration
 * itself anticipated: "later sets can be inserted by an operator without a
 * deploy, which is the point of the table." Schema still goes through
 * migrations; a discovery set for renewals does not.
 *
 * Not a browser feature either. criteria_definitions has no write policy on
 * purpose — a criteria set decides what every scorecard in the product means,
 * and a customer editing one mid-quarter silently re-scores their own
 * history.
 *
 * Every set is validated by defineCriteriaSet() before anything is written,
 * so a file with impossible thresholds fails here rather than at load time in
 * front of somebody on a call. That is the same function the loader uses: one
 * definition of what a valid set is.
 */
import { readFileSync } from 'node:fs';
import Anthropic from '@anthropic-ai/sdk';
import { databaseSink, detectCriteria, T1_DETECTOR, type DetectableSegment } from '@tesserafy/ai';
import { defineCriteriaSet, replay, score, type CriteriaSet } from '@tesserafy/scoring';
import { createServiceClient, fetchCriteria, type SupabaseClient } from '@tesserafy/db';

interface CriterionFile {
  key: string;
  label: string;
  definition: string;
  weight?: number;
  thresholds?: {
    candidate?: number;
    confirm?: number;
    corroboratingSegments?: number;
  };
}

interface CriteriaFile {
  engagementType: string;
  version: number;
  criteria: CriterionFile[];
}

function flag(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`criteria: ${name} is not set`);
    process.exit(2);
  }
  return value;
}

async function list(db: SupabaseClient): Promise<void> {
  const { data, error } = await db
    .from('criteria_definitions')
    .select('engagement_type, version, key')
    .order('engagement_type')
    .order('version');
  if (error) throw new Error(`Listing criteria failed: ${error.message}`);

  const rows = (data ?? []) as { engagement_type: string; version: number; key: string }[];
  if (rows.length === 0) {
    console.info('No criteria sets. That means nothing in this product can score anything.');
    return;
  }

  const sets = new Map<string, number>();
  for (const row of rows) {
    const key = `${row.engagement_type} v${row.version}`;
    sets.set(key, (sets.get(key) ?? 0) + 1);
  }
  for (const [name, count] of sets) {
    console.info(`  ${name.padEnd(28)} ${count} criteria`);
  }
}

async function show(db: SupabaseClient, engagementType: string, version?: number): Promise<void> {
  const rows = await fetchCriteria(db, engagementType, version);
  console.info(`${rows[0]!.engagement_type} v${rows[0]!.version}\n`);
  for (const row of rows) {
    console.info(
      `  ${row.key}  (weight ${row.weight}, candidate ${row.candidate_threshold}, ` +
        `confirm ${row.confirm_threshold}, ${row.corroborating_segments} corroborating)`,
    );
    console.info(`    ${row.label}: ${row.definition}\n`);
  }
}

/**
 * Reads and validates a candidate set without touching the database.
 *
 * Shared by --add and --try, so a set that fails to validate fails the same
 * way whichever you were about to do with it.
 */
function readCandidate(path: string): { parsed: CriteriaFile; validated: CriteriaSet } {
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as CriteriaFile;

  const validated = defineCriteriaSet({
    engagementType: parsed.engagementType,
    version: parsed.version,
    criteria: parsed.criteria.map((criterion) => ({
      key: criterion.key,
      label: criterion.label,
      weight: criterion.weight ?? 1,
      ...(criterion.thresholds ? { thresholds: criterion.thresholds } : {}),
    })),
  });

  for (const criterion of parsed.criteria) {
    if (!criterion.definition || criterion.definition.trim().length === 0) {
      // defineCriteriaSet does not know about definitions \— it scores, it does
      // not prompt \— so this is checked here. A criterion with no definition
      // is a detector with no instructions.
      throw new Error(`Criterion ${criterion.key}: a definition is required; it is the prompt`);
    }
  }

  return { parsed, validated };
}

/** Utterances per window, matching the live path and `pnpm score`. */
const WINDOW_SIZE = 3;

/**
 * Runs a candidate set over a real conversation, and writes nothing.
 *
 * A criterion definition is a prompt. Publishing one without ever running it
 * is shipping a prompt blind: the set validates, the thresholds are sane, and
 * it may still detect nothing at all because the wording does not describe
 * anything a customer actually says out loud.
 *
 * Against a conversation already in the database, so what comes back is what
 * the live path would see rather than what an invented example invites.
 */
async function tryOut(db: SupabaseClient, path: string, conversationId: string): Promise<void> {
  const { parsed, validated } = readCandidate(path);

  const { data: conversation, error: conversationError } = await db
    .from('conversations')
    .select('id, company_id, title')
    .eq('id', conversationId)
    .maybeSingle();
  if (conversationError) {
    throw new Error(`Reading the conversation failed: ${conversationError.message}`);
  }
  if (!conversation) throw new Error(`No conversation ${conversationId}`);

  const {
    id,
    company_id: companyId,
    title,
  } = conversation as { id: string; company_id: string; title: string };

  const { data: segmentRows, error: segmentsError } = await db
    .from('segments')
    .select('id, speaker, start_ms, end_ms, text')
    .eq('conversation_id', id)
    .order('start_ms', { ascending: true });
  if (segmentsError) throw new Error(`Reading segments failed: ${segmentsError.message}`);

  const segments = ((segmentRows ?? []) as {
    id: string;
    speaker: string | null;
    start_ms: number;
    end_ms: number;
    text: string;
  }[]).map(
    (row): DetectableSegment => ({
      id: row.id,
      speaker: row.speaker,
      startMs: row.start_ms,
      endMs: row.end_ms,
      text: row.text,
    }),
  );

  if (segments.length === 0) throw new Error(`${title} has no segments to try this against`);

  const windows: DetectableSegment[][] = [];
  for (let start = 0; start < segments.length; start += 1) {
    windows.push(segments.slice(start, start + WINDOW_SIZE));
    if (start + WINDOW_SIZE >= segments.length) break;
  }

  console.info(
    `${validated.engagementType} v${validated.version} against "${title}": ` +
      `${windows.length} detector call(s) over ${segments.length} utterances.\n`,
  );

  const prompts = parsed.criteria.map((criterion) => ({
    key: criterion.key,
    label: criterion.label,
    definition: criterion.definition.trim(),
  }));

  const client = new Anthropic();
  const events = [];
  let rejected = 0;

  for (const window of windows) {
    const result = await detectCriteria(window, {
      client,
      criteria: prompts,
      // Recorded like any other model call. A trial still costs money, and
      // telemetry that skipped the experiments would understate what getting
      // a criteria set right actually took.
      onUsage: databaseSink({ db, detector: `${T1_DETECTOR}-try`, companyId, conversationId: id }),
    });
    events.push(...result.events);
    rejected += result.rejected.length;
  }

  const card = score(replay(validated, events));

  for (const criterion of card.criteria) {
    console.info(`  ${criterion.status.padEnd(13)} ${criterion.label}`);
    for (const recorded of criterion.evidence) {
      console.info(
        `      ${recorded.confidence.toFixed(2)}  ${recorded.span.quote.slice(0, 96)}`,
      );
    }
    if (criterion.evidence.length === 0) {
      // The useful failure. A criterion that never fires over a real
      // conversation is a wording problem rather than a threshold one, and
      // this is the cheapest place to find that out.
      console.info('      nothing detected');
    }
  }

  console.info(`\n  score ${Math.round(card.score)} / 100`);
  if (rejected > 0) {
    console.info(`  ${rejected} claim(s) dropped for quoting something not in the window`);
  }
  console.info('\nNothing was written. Publish with --add when the wording earns it.');
}

async function add(db: SupabaseClient, path: string, dryRun: boolean): Promise<void> {
  // The same validation the loader applies, run before anything is written:
  // a set with impossible thresholds must fail here, not at load time in
  // front of somebody who is on a call.
  const { parsed, validated } = readCandidate(path);

  const { data: existing, error: existingError } = await db
    .from('criteria_definitions')
    .select('key')
    .eq('engagement_type', validated.engagementType)
    .eq('version', validated.version);
  if (existingError) throw new Error(`Checking for an existing set failed: ${existingError.message}`);

  if ((existing ?? []).length > 0) {
    // Versions are immutable on purpose. A conversation pins the version it
    // was scored against, so editing one in place silently re-scores history
    // that nobody asked to have re-scored. A change is a new version.
    console.error(
      `criteria: ${validated.engagementType} v${validated.version} already exists with ` +
        `${(existing ?? []).length} criteria.\n` +
        `A criteria set is immutable once conversations pin it — publish v${validated.version + 1} instead.`,
    );
    process.exit(1);
  }

  console.info(
    `${validated.engagementType} v${validated.version}, ${validated.criteria.length} criteria:`,
  );
  for (const criterion of validated.criteria) {
    console.info(`  ${criterion.key.padEnd(26)} weight ${criterion.weight}`);
  }

  if (dryRun) {
    console.info('\n--dry-run: valid, nothing written.');
    return;
  }

  const rows = parsed.criteria.map((criterion, index) => {
    const checked = validated.criteria[index]!;
    return {
      engagement_type: validated.engagementType,
      version: validated.version,
      key: checked.key,
      label: checked.label,
      definition: criterion.definition.trim(),
      weight: checked.weight,
      candidate_threshold: checked.thresholds.candidate,
      confirm_threshold: checked.thresholds.confirm,
      corroborating_segments: checked.thresholds.corroboratingSegments,
      position: index + 1,
    };
  });

  const { error } = await db.from('criteria_definitions').insert(rows);
  if (error) throw new Error(`Writing criteria failed: ${error.message}`);

  console.info(
    `\nWritten. Conversations can pin ${validated.engagementType} v${validated.version} from now on; ` +
      `existing ones keep the set they were scored against.`,
  );
}

async function main(): Promise<void> {
  const db = createServiceClient({
    url: requireEnv('SUPABASE_URL'),
    key: requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
  });

  if (process.argv.includes('--list')) {
    await list(db);
    return;
  }

  const showType = flag('--show');
  if (showType) {
    const version = flag('--version');
    await show(db, showType, version ? Number(version) : undefined);
    return;
  }

  const tryPath = flag('--try');
  if (tryPath) {
    const conversationId = flag('--conversation');
    if (!conversationId) {
      console.error('criteria: --try needs --conversation <uuid> to try it against');
      process.exit(2);
    }
    requireEnv('ANTHROPIC_API_KEY');
    await tryOut(db, tryPath, conversationId);
    return;
  }

  const path = flag('--add');
  if (path) {
    await add(db, path, process.argv.includes('--dry-run'));
    return;
  }

  console.error(
    'usage: pnpm criteria --list\n' +
      '       pnpm criteria --show <engagement-type> [--version <n>]\n' +
      '       pnpm criteria --add <file.json> [--dry-run]\n' +
      '       pnpm criteria --try <file.json> --conversation <uuid>',
  );
  process.exit(2);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
