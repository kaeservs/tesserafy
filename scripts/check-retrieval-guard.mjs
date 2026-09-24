#!/usr/bin/env node
// Enforces ADR 0004 by grep: only packages/ai/src/retrieval may touch the
// vector search function or the embeddings table. Feature code that queries
// them directly — even correctly filtered — fails CI.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const FORBIDDEN = /\b(match_segments|segment_embeddings)\b/;

const ALLOWED = [
  /^packages\/ai\/src\/retrieval\//,
  /^packages\/ai\/test\//, // tests of the guard itself
  /^packages\/db\/test\//, // RLS tests assert the table is unreadable
  /^packages\/db\/src\/generated\.ts$/,
  /^supabase\//,
  /^docs\//,
  /^scripts\/check-retrieval-guard\.mjs$/,
  /\.md$/,
];

const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
  encoding: 'utf8',
})
  .split('\n')
  .filter(Boolean)
  .filter((file) => !ALLOWED.some((pattern) => pattern.test(file)));

const violations = [];
for (const file of files) {
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    continue; // deleted in the working tree
  }
  text.split('\n').forEach((line, index) => {
    if (FORBIDDEN.test(line)) violations.push(`${file}:${index + 1}: ${line.trim()}`);
  });
}

// Who may hold the key that bypasses RLS.
//
// The web app runs as the signed-in user, so RLS applies and the key would be
// one bad import away from a browser bundle. The Electron overlay ships to a
// customer's laptop, where the key would simply be handed over.
//
// apps/admin is the exception, and the reason this is a list rather than a
// single prefix: the operator console holds the key deliberately, which is the
// whole reason it is a separate deployment. Naming the exception means the
// next app added under apps/ is refused by default rather than by whether
// anyone remembered to think about it.
const SERVICE_ROLE = /\b(SUPABASE_SERVICE_ROLE_KEY|createServiceClient)\b/;
const serviceRoleViolations = [];
const KEY_HOLDERS = [/^apps\/admin\//];
const appFiles = files.filter(
  (f) => f.startsWith('apps/') && !KEY_HOLDERS.some((pattern) => pattern.test(f)),
);
for (const file of appFiles) {
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    continue;
  }
  text.split('\n').forEach((line, index) => {
    if (SERVICE_ROLE.test(line)) serviceRoleViolations.push(`${file}:${index + 1}: ${line.trim()}`);
  });
}

if (violations.length > 0) {
  console.error('Retrieval guard: vector search outside packages/ai/src/retrieval (ADR 0004).');
  console.error('Use retrieve(companyId, query, opts) from @tesserafy/ai instead.\n');
  for (const v of violations) console.error(`  ${v}`);
}
if (serviceRoleViolations.length > 0) {
  console.error('Retrieval guard: service-role access in an app that must not hold it.');
  console.error('Only apps/admin may, and only because it is deployed separately.\n');
  for (const v of serviceRoleViolations) console.error(`  ${v}`);
}
if (violations.length > 0 || serviceRoleViolations.length > 0) {
  process.exit(1);
}

console.log(`Retrieval guard: ${files.length} files checked, no violations.`);
