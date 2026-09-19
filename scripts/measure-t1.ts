/**
 * Measure T1 run beside the model instead of from a client.
 *
 *   pnpm measure:t1 <base-url> --criteria <criteria.json> --window <file.vtt> [--runs 5]
 *
 * Spike S3 left one candidate topology standing. This puts a number on it by
 * separating three things a single stopwatch cannot:
 *
 *   round trip   what this machine waits, end to end
 *   serverMs     what the endpoint spent, model included
 *   model ms     what the model itself took, from usage
 *
 * round trip - serverMs is the network cost of *reaching the endpoint*, which
 * a laptop pays and a co-located caller does not. serverMs - model ms is the
 * endpoint's own overhead. The budget question is whether model ms alone fits
 * 700 ms, because that is the floor no topology can go below.
 *
 * A session token comes from the Supabase admin API rather than a browser, so
 * this can run unattended. It needs SUPABASE_SERVICE_ROLE_KEY, which is why
 * this lives in scripts/ and not in the web app.
 */
import { readFileSync } from 'node:fs';
import { toSegments, parseVtt } from '@tesserafy/ingest';

const [baseUrl, ...rest] = process.argv.slice(2);
if (!baseUrl) {
  console.error(
    'usage: pnpm measure:t1 <base-url> --criteria <criteria.json> --window <file.vtt> [--runs 5]',
  );
  process.exit(2);
}

function flag(name: string): string | undefined {
  const index = rest.indexOf(name);
  return index === -1 ? undefined : rest[index + 1];
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`measure:t1: ${name} is not set`);
    process.exit(2);
  }
  return value;
}

/** A session for the given user, without a browser. */
async function accessToken(email: string): Promise<string> {
  const url = requireEnv('SUPABASE_URL');
  const key = requireEnv('SUPABASE_SERVICE_ROLE_KEY');

  const generated = await fetch(new URL('/auth/v1/admin/generate_link', url), {
    method: 'POST',
    headers: { apikey: key, authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'magiclink', email }),
  });
  if (!generated.ok) {
    throw new Error(`generate_link failed: ${generated.status} ${await generated.text()}`);
  }
  const link = (await generated.json()) as { properties?: { hashed_token?: string } };
  const hashed = link.properties?.hashed_token;
  if (!hashed) throw new Error('generate_link returned no hashed_token');

  const verified = await fetch(new URL('/auth/v1/verify', url), {
    method: 'POST',
    headers: { apikey: key, 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'magiclink', token_hash: hashed }),
  });
  if (!verified.ok) {
    throw new Error(`verify failed: ${verified.status} ${await verified.text()}`);
  }
  const session = (await verified.json()) as { access_token?: string };
  if (!session.access_token) throw new Error('verify returned no access token');
  return session.access_token;
}

function percentile(samples: readonly number[], p: number): number {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)] ?? 0;
}

async function main(): Promise<void> {
  const criteriaPath = flag('--criteria') ?? '';
  const windowPath = flag('--window') ?? '';
  const runs = Number(flag('--runs') ?? 5);
  const email = flag('--email') ?? requireEnv('T1_PROBE_EMAIL');
  if (!criteriaPath || !windowPath) {
    console.error('measure:t1: --criteria and --window are required');
    process.exit(2);
  }

  const criteria = JSON.parse(readFileSync(criteriaPath, 'utf8')) as { criteria: unknown[] };
  const transcript = parseVtt(readFileSync(windowPath, 'utf8'));
  const window = toSegments(transcript.turns).map((draft, index) => ({
    id: `s${index}`,
    speaker: draft.speaker,
    startMs: draft.startMs,
    endMs: draft.endMs,
    text: draft.text,
  }));

  const token = await accessToken(email);
  const endpoint = new URL('/api/detect', baseUrl);

  const roundTrips: number[] = [];
  const serverTimes: number[] = [];
  const modelTimes: number[] = [];
  const cacheReads: number[] = [];

  for (let i = 0; i < runs; i++) {
    const startedAt = Date.now();
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ criteria: criteria.criteria, window }),
    });
    const roundTrip = Date.now() - startedAt;

    if (!response.ok) {
      throw new Error(`detect failed: ${response.status} ${await response.text()}`);
    }
    const body = (await response.json()) as {
      serverMs: number;
      usage: { durationMs: number; cacheReadInputTokens: number };
      events: unknown[];
    };

    roundTrips.push(roundTrip);
    serverTimes.push(body.serverMs);
    modelTimes.push(body.usage.durationMs);
    cacheReads.push(body.usage.cacheReadInputTokens);
    console.info(
      `run ${i + 1}: round trip ${roundTrip} ms · server ${body.serverMs} ms · ` +
        `model ${body.usage.durationMs} ms · ${body.events.length} event(s)`,
    );
  }

  const report = (label: string, samples: number[]) =>
    console.info(
      `${label.padEnd(14)} p50 ${percentile(samples, 0.5)} ms   p95 ${percentile(samples, 0.95)} ms`,
    );

  console.info('');
  report('round trip', roundTrips);
  report('server', serverTimes);
  report('model', modelTimes);
  console.info(
    `network to endpoint: ~${percentile(roundTrips, 0.5) - percentile(serverTimes, 0.5)} ms at p50`,
  );
  console.info(`cache reads: ${cacheReads.filter((c) => c > 0).length}/${runs} calls`);
  console.info(`\nT1 budget is 700 ms. The model alone is the floor no topology can beat.`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
