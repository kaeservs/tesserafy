/**
 * Regenerate the database types.
 *
 *   pnpm db:types
 *
 * The script this replaces was `supabase gen types typescript --local`, which
 * needs the whole local stack up in Docker. It had never been run, so
 * `packages/db/src/generated.ts` did not exist, so every query in the codebase
 * was cast by hand from `unknown` — dozens of `as` assertions, each one a
 * claim about the schema that nothing checked. A cast is a comment that the
 * compiler believes.
 *
 * This generates against the project itself, which needs no Docker and, more
 * to the point, describes the schema that is actually deployed rather than
 * whatever a local stack was last migrated to. It needs SUPABASE_ACCESS_TOKEN
 * and SUPABASE_PROJECT_ID.
 *
 * The banner is written here rather than left to the generator, because a
 * generated file with no warning on it is one somebody will eventually edit.
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const OUT = 'packages/db/src/generated.ts';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`db:types: ${name} is not set`);
    process.exit(2);
  }
  return value;
}

const projectId = requireEnv('SUPABASE_PROJECT_ID');
requireEnv('SUPABASE_ACCESS_TOKEN');

// A project ref is lowercase alphanumeric. Checked because the command below
// runs through a shell on Windows, where Node 24 refuses to spawn a .cmd any
// other way, and a value that reaches a shell unchecked is a value that can
// bring its own arguments.
if (!/^[a-z0-9]+$/.test(projectId)) {
  console.error(`db:types: SUPABASE_PROJECT_ID is not a project ref: ${projectId}`);
  process.exit(2);
}

const windows = process.platform === 'win32';
const cli = resolve('node_modules/.bin', windows ? 'supabase.cmd' : 'supabase');
const args = ['gen', 'types', 'typescript', '--project-id', projectId];

// Node 24 refuses to spawn a .cmd directly (EINVAL). Handing it to the command
// interpreter as an argument does the same job without `shell: true`, which
// concatenates arguments instead of passing them and is deprecated for saying
// so out loud.
const generated = windows
  ? execFileSync(process.env['ComSpec'] ?? 'cmd.exe', ['/d', '/s', '/c', cli, ...args], {
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
    })
  : execFileSync(cli, args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });

const banner = `/**
 * Generated from the deployed schema. Do not edit.
 *
 *   pnpm db:types
 *
 * Every hand-written type for a row is a claim about the schema that nothing
 * checks, and it stays convincing long after the column it describes has
 * changed. These are the claim the database itself makes.
 */
`;

writeFileSync(OUT, banner + generated.replace(/^\uFEFF/, ''), 'utf8');
console.log(`db:types: wrote ${OUT} (${generated.split('\n').length} lines) from project ${projectId}`);
