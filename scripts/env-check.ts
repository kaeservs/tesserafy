/**
 * What is set, what is missing, and which project you are about to touch.
 *
 *   pnpm env:check
 *
 * Every operator script used to fail on the first variable it needed and then,
 * once that was set, on the second. That was the pattern for six rounds of
 * `pnpm qa` not running at all. This reads the same `.env` the scripts now
 * read, and answers for every command at once.
 *
 * It never prints a secret. It prints the one thing that is worth seeing
 * before anything runs: the host the scripts will talk to. The scripts load
 * `.env` on their own now, which is convenient and also means `pnpm erase
 * --purge` needs no typing to reach production. Knowing which database a
 * command is pointed at should not require reading a file.
 */

interface Need {
  readonly required: readonly string[];
  readonly optional?: readonly string[];
}

/** Kept by hand next to the scripts it describes. A new script adds a line. */
const COMMANDS: Record<string, Need> = {
  qa: { required: ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'], optional: ['TESSERAFY_URL', 'SUPABASE_PUBLISHABLE_KEY'] },
  health: { required: ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'] },
  support: { required: ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPPORT_ADMIN_EMAIL'], optional: ['SUPABASE_PUBLISHABLE_KEY'] },
  costs: { required: ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'] },
  erase: { required: ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'] },
  score: { required: ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'], optional: ['ANTHROPIC_API_KEY'] },
  process: { required: ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'ANTHROPIC_API_KEY'] },
  ingest: { required: ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'ANTHROPIC_API_KEY'] },
  insights: { required: ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'ANTHROPIC_API_KEY'] },
  criteria: { required: ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'ANTHROPIC_API_KEY'] },
  'smoke:tiers': { required: ['ANTHROPIC_API_KEY'] },
  'db:types': { required: ['SUPABASE_ACCESS_TOKEN', 'SUPABASE_PROJECT_ID'] },
};

function present(name: string): boolean {
  return Boolean(process.env[name]?.trim());
}

function host(value: string | undefined): string {
  if (!value) return 'not set';
  try {
    return new URL(value).host;
  } catch {
    return 'not a URL';
  }
}

const url = process.env['SUPABASE_URL'];
const local = /^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host(url));

console.log(`\nSupabase:  ${host(url)}${url ? (local ? '   (local stack)' : '   (REMOTE — production data)') : ''}`);
if (process.env['TESSERAFY_URL']) console.log(`Web app:   ${host(process.env['TESSERAFY_URL'])}`);
console.log('');

let ready = 0;
for (const [command, need] of Object.entries(COMMANDS)) {
  const missing = need.required.filter((name) => !present(name));
  const unset = (need.optional ?? []).filter((name) => !present(name));
  if (missing.length === 0) ready += 1;

  const mark = missing.length === 0 ? 'ok  ' : 'NO  ';
  const detail =
    missing.length > 0
      ? `missing ${missing.join(', ')}`
      : unset.length > 0
        ? `(optional, unset: ${unset.join(', ')})`
        : '';
  console.log(`  ${mark}pnpm ${command.padEnd(12)} ${detail}`);
}

console.log(`\n${ready} of ${Object.keys(COMMANDS).length} commands can run.`);
if (!process.env['SUPABASE_SERVICE_ROLE_KEY']) {
  console.log('Most need SUPABASE_SERVICE_ROLE_KEY: Supabase → Project Settings → API Keys.');
}
