/**
 * Criteria sets, which are data.
 *
 *   pnpm criteria --list
 *   pnpm criteria --add <file.json>
 *   pnpm criteria --add <file.json> --dry-run
 *   pnpm criteria --show <engagement-type> [--version <n>]
 *   pnpm criteria --try <file.json> --conversation <uuid>
 *   pnpm criteria --try <file.json> --company <uuid> [--sample 5]
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
      // defineCriteriaSet does not know about definitions — it scores, it does
      // not prompt — so this is checked here. A criterion with no definition
      // is a detector with no instructions.
      throw new Error(`Criterion ${criterion.key}: a definition is required; it is the prompt`);
    }
  }

  return { parsed, validated };
}

/** Utterances per window, matching the live path and `pnpm score`. */
const WINDOW_SIZE = 3;

/** Conversations sampled when trying a set against a company. */
const DEFAULT_SAMPLE = 5;

interface TrialSubject {
  id: string;
  company_id: string;
  title: string;
  engagement_type: string;
}

/**
 * Runs a candidate set over real conversations, and writes nothing.
 *
 * A criterion definition is a prompt. Publishing one without ever running it
 * is shipping a prompt blind: the set validates, the thresholds are sane, and
 * it may still detect nothing at all because the wording does not describe
 * anything a customer actually says out loud.
 *
 * Several conversations by default, because one is the wrong number. A
 * definition tuned until one transcript lights up is a definition that has
 * learned that transcript, and the first version of this command could only
 * ask about one call — which invited exactly the failure its own
 * documentation warned about. What matters is not whether a criterion fires
 * here; it is how often it fires across calls that are not alike.
 *
 * Against conversations already in the database, so what comes back is what
 * the live path would see rather than what an invented example invites.
 */
async function tryOut(
  db: SupabaseClient,
  path: string,
  subjects: readonly TrialSubject[],
): Promise<void> {
  const { parsed, validated } = readCandidate(path);

  const windowsFor = new Map<string, DetectableSegment[][]>();
  for (const subject of subjects) {
    const { data: segmentRows, error } = await db
      .from('segments')
      .select('id, speaker, start_ms, end_ms, text')
      .eq('conversation_id', subject.id)
      .order('start_ms', { ascending: true });
    if (error) throw new Error(`Reading segments failed: ${error.message}`);

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
    if (segments.length === 0) continue;

    const windows: DetectableSegment[][] = [];
    for (let start = 0; start < segments.length; start += 1) {
      windows.push(segments.slice(start, start + WINDOW_SIZE));
      if (start + WINDOW_SIZE >= segments.length) break;
    }
    windowsFor.set(subject.id, windows);
  }

  const usable = subjects.filter((subject) => windowsFor.has(subject.id));
  if (usable.length === 0) throw new Error('None of those conversations has a transcript');

  const calls = [...windowsFor.values()].reduce((sum, windows) => sum + windows.length, 0);
  console.info(
    `${validated.engagementType} v${validated.version} against ${usable.length} ` +
      `conversation(s): ${calls} detector call(s).\n`,
  );

  const prompts = parsed.criteria.map((criterion) => ({
    key: criterion.key,
    label: criterion.label,
    definition: criterion.definition.trim(),
  }));

  const client = new Anthropic();
  // Per criterion, how many conversations reached each state. The question a
  // set has to answer is not "did it fire" but "how often, across calls that
  // are not alike".
  const confirmed = new Map<string, number>();
  const partial = new Map<string, number>();
  const examples = new Map<string, { quote: string; confidence: number }>();
  let rejected = 0;

  for (const subject of usable) {
    const events = [];
    for (const window of windowsFor.get(subject.id)!) {
      const result = await detectCriteria(window, {
        client,
        criteria: prompts,
        // Recorded like any other model call. A trial still costs money, and
        // telemetry that skipped the experiments would understate what
        // getting a criteria set right actually took.
        onUsage: databaseSink({
          db,
          detector: `${T1_DETECTOR}-try`,
          companyId: subject.company_id,
          conversationId: subject.id,
        }),
      });
      events.push(...result.events);
      rejected += result.rejected.length;
    }

    const card = score(replay(validated, events));
    console.info(
      `  ${String(Math.round(card.score)).padStart(3)}  ${subject.title} ` +
        `(${subject.engagement_type})`,
    );

    for (const criterion of card.criteria) {
      if (criterion.status === 'confirmed') {
        confirmed.set(criterion.key, (confirmed.get(criterion.key) ?? 0) + 1);
      } else if (criterion.status === 'candidate') {
        partial.set(criterion.key, (partial.get(criterion.key) ?? 0) + 1);
      }
      const best = criterion.evidence[0];
      if (best && !examples.has(criterion.key)) {
        examples.set(criterion.key, { quote: best.span.quote, confidence: best.confidence });
      }
    }
  }

  // What the set was tried against, said plainly. A renewal set run over
  // discovery calls tells you how the wording behaves on the wrong material:
  // a criterion that never fires may be perfectly right, and one that fires
  // everywhere is probably matching something it was not meant to. Neither
  // reading is safe without knowing what the sample was.
  const matching = usable.filter(
    (subject) => subject.engagement_type === validated.engagementType,
  ).length;
  if (matching < usable.length) {
    console.info(
      `\n  note: ${usable.length - matching} of ${usable.length} are not ` +
        `${validated.engagementType} conversations. A criterion that never fires here may be ` +
        `right, and one that fires everywhere is suspect.`,
    );
  }

  console.info(`\n  across ${usable.length} conversation(s):`);
  for (const criterion of validated.criteria) {
    const yes = confirmed.get(criterion.key) ?? 0;
    const maybe = partial.get(criterion.key) ?? 0;
    const example = examples.get(criterion.key);

    console.info(
      `    ${String(yes).padStart(2)}/${usable.length} confirmed` +
        `${maybe > 0 ? `, ${maybe} partial` : '           '.slice(0, 0)}` +
        `  ${criterion.label}`,
    );
    if (yes === 0 && maybe === 0) {
      // The finding worth having. A criterion that never fires anywhere is a
      // wording problem rather than a threshold one, and no amount of
      // re-running one transcript will show it.
      console.info('         never detected — the wording may not describe what people say');
    } else if (example) {
      console.info(`         e.g. ${example.confidence.toFixed(2)} ${example.quote.slice(0, 84)}`);
    }
  }

  if (rejected > 0) {
    console.info(`\n  ${rejected} claim(s) dropped for quoting something not in the window`);
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
    const companyId = flag('--company');
    if (!conversationId && !companyId) {
      console.error(
        'criteria: --try needs --conversation <uuid> or --company <uuid> to try it against',
      );
      process.exit(2);
    }
    requireEnv('ANTHROPIC_API_KEY');

    let query = db.from('conversations').select('id, company_id, title, engagement_type');
    query = conversationId ? query.eq('id', conversationId) : query.eq('company_id', companyId!);

    const { data, error } = await query.order('occurred_at', { ascending: false });
    if (error) throw new Error(`Listing conversations failed: ${error.message}`);

    const found = (data ?? []) as TrialSubject[];
    if (found.length === 0) throw new Error('No conversations matched');

    // Newest first, then capped: a sample that quietly grew with the corpus
    // would make the command cost more every month for no more insight.
    const sample = Number(flag('--sample') ?? DEFAULT_SAMPLE);
    const subjects = conversationId
      ? found
      : found.slice(0, Number.isInteger(sample) && sample > 0 ? sample : DEFAULT_SAMPLE);

    await tryOut(db, tryPath, subjects);
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
      '       pnpm criteria --try <file.json> --conversation <uuid>\n' +
      '       pnpm criteria --try <file.json> --company <uuid> [--sample 5]',
  );
  process.exit(2);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
