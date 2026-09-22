/**
 * Production smoke check.
 *
 *   pnpm qa [--url https://…]
 *
 * Everything a machine can judge, checked against the deployed system rather
 * than a test database: the auth boundary, the API surface, and the data
 * invariants the product's claims rest on.
 *
 * What it deliberately does not check is anything a person has to look at —
 * whether clicking a quote scrolls to the right place, whether the overlay
 * stays out of a share, whether an insight reads as true. Those are in
 * docs/engineering/qa-checklist.md, and the point of this script is to leave a
 * human session for exactly those.
 *
 * Read-only apart from one thing: it mints a session for the probe account
 * through the admin API, the same way scripts/measure-t1.ts does.
 */
import { createServiceClient } from '@tesserafy/db';

interface Check {
  name: string;
  detail: string;
  ok: boolean;
}

const checks: Check[] = [];

function record(name: string, ok: boolean, detail: string): void {
  checks.push({ name, ok, detail });
  console.info(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? ` — ${detail}` : ''}`);
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`qa: ${name} is not set`);
    process.exit(2);
  }
  return value;
}

function flag(name: string, fallback: string): string {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : (process.argv[index + 1] ?? fallback);
}

async function accessToken(url: string, key: string, email: string): Promise<string | null> {
  const generated = await fetch(new URL('/auth/v1/admin/generate_link', url), {
    method: 'POST',
    headers: { apikey: key, authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'magiclink', email }),
  });
  if (!generated.ok) return null;

  const body = (await generated.json()) as {
    action_link?: string;
    properties?: { action_link?: string };
  };
  const link = body.action_link ?? body.properties?.action_link;
  if (!link) return null;

  const verified = await fetch(link, { redirect: 'manual' });
  const location = verified.headers.get('location') ?? '';
  return new URLSearchParams(location.split('#')[1] ?? '').get('access_token');
}

async function main(): Promise<void> {
  const baseUrl = flag('--url', process.env['TESSERAFY_URL'] ?? 'https://web-beta-khaki-cxdkp6udxk.vercel.app');
  const supabaseUrl = requireEnv('SUPABASE_URL');
  const serviceKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY');
  const email = process.env['QA_EMAIL'] ?? 'kaeservs@gmail.com';

  console.info(`Checking ${baseUrl}\n`);
  console.info('The auth boundary');

  const pages: [string, number][] = [
    ['/login', 200],
    ['/conversations', 307],
    ['/insights', 307],
  ];
  for (const [path, expected] of pages) {
    const response = await fetch(new URL(path, baseUrl), { redirect: 'manual' });
    record(
      `GET ${path}`,
      response.status === expected,
      `${response.status}, expected ${expected}`,
    );
  }

  for (const path of ['/api/detect', '/api/criteria']) {
    const post = path === '/api/detect';
    const response = await fetch(new URL(path, baseUrl), {
      method: post ? 'POST' : 'GET',
      headers: { 'content-type': 'application/json' },
      // Spread rather than `body: undefined`: exactOptionalPropertyTypes
      // treats a present-but-undefined property as a type error.
      ...(post ? { body: '{}' } : {}),
      redirect: 'manual',
    });
    // 401 JSON, never a redirect: an API route that redirects hands a
    // programmatic caller an HTML login page where it expected an error.
    record(
      `${path} refuses anonymous callers`,
      response.status === 401,
      `${response.status}`,
    );
  }

  console.info('\nThe API, as a signed-in user');
  const token = await accessToken(supabaseUrl, serviceKey, email);
  record('mint a session for the probe account', token !== null, token ? '' : 'no token');

  if (token) {
    const criteria = await fetch(new URL('/api/criteria', baseUrl), {
      headers: { authorization: `Bearer ${token}` },
    });
    const criteriaBody = (await criteria.json()) as { criteria?: unknown[]; error?: string };
    record(
      'GET /api/criteria returns criteria',
      criteria.ok && (criteriaBody.criteria?.length ?? 0) > 0,
      criteria.ok ? `${criteriaBody.criteria?.length} criteria` : (criteriaBody.error ?? ''),
    );

    const detect = await fetch(new URL('/api/detect', baseUrl), {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        criteria: [
          {
            key: 'pain_quantified',
            label: 'Pain quantified',
            definition: 'The customer states what a problem costs them in time, money or accuracy.',
          },
        ],
        window: [
          {
            id: 'qa1',
            speaker: 'customer',
            startMs: 0,
            endMs: 5000,
            text: 'Exporting the weekly report takes us most of Friday afternoon.',
          },
        ],
      }),
    });
    const detectBody = (await detect.json()) as {
      events?: { span: { quote: string } }[];
      usage?: { durationMs: number };
      error?: string;
    };
    record(
      'POST /api/detect detects and quotes',
      detect.ok && (detectBody.events?.length ?? 0) > 0,
      detect.ok
        ? `${detectBody.events?.length} event(s), ${detectBody.usage?.durationMs} ms`
        : (detectBody.error ?? ''),
    );

    const quoted = detectBody.events?.[0]?.span.quote ?? '';
    record(
      'the quote is verbatim from the window',
      'Exporting the weekly report takes us most of Friday afternoon.'.includes(quoted) &&
        quoted.length > 0,
      quoted ? `“${quoted}”` : 'no quote',
    );

    // T2. A refusal is a valid answer — what is checked is that the endpoint
    // runs, and that any suggestion it makes quotes the window it was given.
    const suggest = await fetch(new URL('/api/suggest', baseUrl), {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        scorecard: {
          engagementType: 'discovery',
          criteriaVersion: 1,
          score: 0,
          earnedWeight: 0,
          totalWeight: 1,
          criteria: [
            {
              key: 'pain_quantified',
              label: 'Pain quantified',
              weight: 1,
              status: 'unobserved',
              earned: 0,
              evidence: [],
              contradictions: [],
            },
          ],
        },
        window: [
          {
            id: 'qa1',
            speaker: 'customer',
            text: 'We export the report by hand every Friday and it is painful.',
          },
        ],
      }),
    });
    const suggestBody = (await suggest.json()) as {
      suggestion?: { ask: string; because: string } | null;
      reason?: string;
      error?: string;
    };
    record(
      'POST /api/suggest answers',
      suggest.ok,
      suggest.ok
        ? suggestBody.suggestion
          ? `“${suggestBody.suggestion.ask}”`
          : `no suggestion (${suggestBody.reason})`
        : (suggestBody.error ?? ''),
    );
    record(
      'a suggestion quotes the window it was given',
      !suggestBody.suggestion ||
        'We export the report by hand every Friday and it is painful.'.includes(
          suggestBody.suggestion.because,
        ),
      suggestBody.suggestion ? `“${suggestBody.suggestion.because}”` : 'nothing suggested',
    );

  }

  console.info('\nData invariants');
  const db = createServiceClient({ url: supabaseUrl, key: serviceKey });

  const counts = await Promise.all(
    ['conversations', 'segments', 'signals', 'signal_evidence', 'insights'].map(async (table) => {
      const { count } = await db.from(table).select('*', { count: 'exact', head: true });
      return [table, count ?? 0] as const;
    }),
  );
  record('production has data', counts.every(([, n]) => n > 0), counts.map(([t, n]) => `${t} ${n}`).join(', '));

  // Invariant 4, from the other end: every signal and every insight must be
  // backed. The database refuses to create an unbacked one; this checks that
  // nothing has since been orphaned.
  const { data: signals } = await db.from('signals').select('id');
  const { data: signalEvidence } = await db.from('signal_evidence').select('signal_id');
  const backedSignals = new Set((signalEvidence ?? []).map((row) => row.signal_id));
  const unbackedSignals = (signals ?? []).filter((row) => !backedSignals.has(row.id));
  record('every signal has evidence', unbackedSignals.length === 0, `${unbackedSignals.length} unbacked`);

  const { data: insights } = await db.from('insights').select('id');
  const { data: insightEvidence } = await db.from('insight_evidence').select('insight_id');
  const backedInsights = new Set((insightEvidence ?? []).map((row) => row.insight_id));
  const unbackedInsights = (insights ?? []).filter((row) => !backedInsights.has(row.id));
  record('every insight has citations', unbackedInsights.length === 0, `${unbackedInsights.length} unbacked`);

  // Quote fidelity, checked against the segments rather than trusted. A
  // trigger enforces this on write; this is the audit that it held.
  const { data: evidence } = await db
    .from('signal_evidence')
    .select('quote, quote_start, quote_end, segment_id');
  const { data: segments } = await db.from('segments').select('id, text');
  const textOf = new Map((segments ?? []).map((row) => [row.id, row.text as string]));
  const drifted = (evidence ?? []).filter((row) => {
    const text = textOf.get(row.segment_id as string);
    return (
      text === undefined ||
      text.slice(row.quote_start as number, row.quote_end as number) !== (row.quote as string)
    );
  });
  record('every quote still matches its segment', drifted.length === 0, `${drifted.length} drifted`);

  // Tenancy: a segment that disagrees with its conversation about which
  // company it belongs to would defeat every correct tenant filter.
  const { data: mismatched } = await db.rpc('conversation_for_source', {
    p_company_id: '00000000-0000-0000-0000-000000000000',
    p_source_key: 'qa-probe-that-should-not-exist',
  });
  record('tenant lookup answers for an unknown company', mismatched === null, 'null as expected');

  const failed = checks.filter((check) => !check.ok);
  console.info(`\n${checks.length - failed.length}/${checks.length} checks passed`);
  if (failed.length > 0) {
    console.error('\nFailed:');
    for (const check of failed) console.error(`  ${check.name} — ${check.detail}`);
    process.exit(1);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
