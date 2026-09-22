/**
 * Criteria sets, which are data.
 *
 *   pnpm criteria --list
 *   pnpm criteria --add <file.json>
 *   pnpm criteria --add <file.json> --dry-run
 *   pnpm criteria --show <engagement-type> [--version <n>]
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
import { defineCriteriaSet } from '@tesserafy/scoring';
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

async function add(db: SupabaseClient, path: string, dryRun: boolean): Promise<void> {
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as CriteriaFile;

  // The same validation the loader applies, run before anything is written:
  // a set with impossible thresholds must fail here, not at load time in
  // front of somebody who is on a call.
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

  const path = flag('--add');
  if (path) {
    await add(db, path, process.argv.includes('--dry-run'));
    return;
  }

  console.error(
    'usage: pnpm criteria --list\n' +
      '       pnpm criteria --show <engagement-type> [--version <n>]\n' +
      '       pnpm criteria --add <file.json> [--dry-run]',
  );
  process.exit(2);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
