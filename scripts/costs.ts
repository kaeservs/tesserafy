/**
 * What the models have cost.
 *
 *   pnpm costs [--days 30]
 *
 * Reads the rows that scripts/qa.ts cannot: model_usage, written by every
 * call site. Prices are the published per-million rates at the time of
 * writing and are stated in the output, because a cost report that hides its
 * assumptions invites someone to quote it in a pricing meeting.
 */
import { createServiceClient } from '@tesserafy/db';

/** USD per million tokens, input / output. */
const PRICES: Record<string, { input: number; output: number }> = {
  'claude-opus-5': { input: 5, output: 25 },
  'claude-sonnet-5': { input: 2, output: 10 },
  'claude-haiku-4-5': { input: 1, output: 5 },
};

/*
 * Cached tokens are billed against the input rate — not for free, and not at
 * it. Writing the cache costs a quarter more than sending those tokens
 * plainly; reading it costs a tenth. The API reports both outside
 * `input_tokens`, so a report that prices only input and output prices
 * neither: it undercounts every cache read and misses the premium on every
 * cache write. Caching does not currently engage here at all (spike S3: the
 * frozen prefix is below Haiku's minimum cacheable size), which is precisely
 * why this is worth fixing now rather than once the numbers start moving.
 */
const CACHE_WRITE_MULTIPLIER = 1.25;
const CACHE_READ_MULTIPLIER = 0.1;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`costs: ${name} is not set`);
    process.exit(2);
  }
  return value;
}

interface Row {
  company_id: string | null;
  tier: string;
  model: string;
  detector: string | null;
  input_tokens: number;
  output_tokens: number;
  cache_creation_tokens: number;
  cache_read_tokens: number;
  duration_ms: number;
}

function cost(row: Row): number {
  const price = PRICES[row.model];
  if (!price) return 0;
  return (
    (row.input_tokens / 1e6) * price.input +
    (row.output_tokens / 1e6) * price.output +
    (row.cache_creation_tokens / 1e6) * price.input * CACHE_WRITE_MULTIPLIER +
    (row.cache_read_tokens / 1e6) * price.input * CACHE_READ_MULTIPLIER
  );
}

async function main(): Promise<void> {
  const daysIndex = process.argv.indexOf('--days');
  const days = daysIndex === -1 ? 30 : Number(process.argv[daysIndex + 1] ?? 30);
  if (!Number.isFinite(days) || days <= 0) {
    // Otherwise the window becomes an Invalid Date and the script dies on a
    // RangeError thrown from inside toISOString(), which explains nothing.
    console.error(`costs: --days wants a positive number, got ${process.argv[daysIndex + 1]}`);
    process.exit(2);
  }
  const since = new Date(Date.now() - days * 86_400_000).toISOString();

  const db = createServiceClient({
    url: requireEnv('SUPABASE_URL'),
    key: requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
  });

  const { data, error } = await db
    .from('model_usage')
    .select(
      'company_id, tier, model, detector, input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens, duration_ms',
    )
    .gte('created_at', since);
  if (error) throw new Error(`Reading usage failed: ${error.message}`);

  const rows = (data ?? []) as Row[];
  if (rows.length === 0) {
    console.info(`No model calls recorded in the last ${days} days.`);
    return;
  }

  const byTier = new Map<string, { calls: number; cost: number; ms: number; unknown: number }>();
  for (const row of rows) {
    const key = `${row.tier} · ${row.model}${row.detector ? ` · ${row.detector}` : ''}`;
    const entry = byTier.get(key) ?? { calls: 0, cost: 0, ms: 0, unknown: 0 };
    entry.calls += 1;
    entry.cost += cost(row);
    entry.ms += row.duration_ms;
    if (!PRICES[row.model]) entry.unknown += 1;
    byTier.set(key, entry);
  }

  console.info(`${rows.length} model calls in the last ${days} days\n`);
  console.info(`${'tier · model · detector'.padEnd(46)}${'calls'.padStart(7)}${'cost'.padStart(10)}${'avg ms'.padStart(9)}`);
  let total = 0;
  for (const [key, entry] of [...byTier].sort((a, b) => b[1].cost - a[1].cost)) {
    total += entry.cost;
    const unpriced = entry.unknown > 0 ? ` (${entry.unknown} unpriced)` : '';
    console.info(
      `${(key + unpriced).padEnd(46)}${String(entry.calls).padStart(7)}${('$' + entry.cost.toFixed(4)).padStart(10)}${String(Math.round(entry.ms / entry.calls)).padStart(9)}`,
    );
  }

  const cacheRead = rows.reduce((sum, row) => sum + row.cache_read_tokens, 0);
  const cacheWritten = rows.reduce((sum, row) => sum + row.cache_creation_tokens, 0);
  console.info(`\ntotal $${total.toFixed(2)}`);
  console.info(
    `cache reads ${cacheRead} tokens across ${rows.filter((r) => r.cache_read_tokens > 0).length}/${rows.length} calls, ${cacheWritten} written`,
  );
  console.info('\nPrices: opus-5 $5/$25, sonnet-5 $2/$10, haiku-4.5 $1/$5 per million in/out.');
  console.info('Cached tokens bill against the input rate: 1.25x to write, 0.1x to read.');
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
