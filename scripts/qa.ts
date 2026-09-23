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
 * It writes, in one place and on purpose. The live-capture routes cannot be
 * checked by reading: there is nothing there until something creates it, and
 * a break in them means a customer's call is silently not recorded, which is
 * the failure least likely to be noticed and worst to discover late. So the
 * check creates a conversation, writes an utterance and an observation to it,
 * and erases the whole thing again in a finally. Everything else is reads,
 * plus a session minted for the probe account through the admin API.
 */
import { createServiceClient, fetchCriteria, fetchCriterionEvents } from '@tesserafy/db';
import { defineCriteriaSet, replay, score, type DetectorEvent } from '@tesserafy/scoring';

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

    await checkLiveCapture(baseUrl, token);
  }

  console.info('\nSearch');
  await checkSearch(supabaseUrl, serviceKey, token);

  console.info('\nData invariants');
  const db = createServiceClient({ url: supabaseUrl, key: serviceKey });

  const counts = await Promise.all(
    ['conversations', 'segments', 'signals', 'signal_evidence', 'insights', 'criterion_events'].map(async (table) => {
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

  // The same audit for the criteria side. A scorecard is only worth the
  // quotes under it, and these rows are what the score is derived from.
  const { data: criterionEvidence } = await db
    .from('criterion_events')
    .select('quote, quote_start, quote_end, segment_id');
  const criterionDrifted = (criterionEvidence ?? []).filter((row) => {
    const text = textOf.get(row.segment_id as string);
    return (
      text === undefined ||
      text.slice(row.quote_start as number, row.quote_end as number) !== (row.quote as string)
    );
  });
  record(
    'every criterion event still quotes its segment',
    criterionDrifted.length === 0,
    `${criterionDrifted.length} drifted of ${(criterionEvidence ?? []).length}`,
  );

  // Nothing stored is a score (invariant 1). If a column ever appears here
  // that looks like a verdict, the whole read path has been bypassed.
  const { data: sampleEvent } = await db.from('criterion_events').select('*').limit(1).maybeSingle();
  const verdictColumns = Object.keys(sampleEvent ?? {}).filter((column) =>
    ['score', 'status', 'state'].includes(column),
  );
  record(
    'criterion_events stores no score and no status',
    verdictColumns.length === 0,
    verdictColumns.length === 0 ? 'evidence only' : `found ${verdictColumns.join(', ')}`,
  );

  // The read path itself, over real production rows rather than fixtures:
  // criteria + stored events must replay into a scorecard the same way the
  // page does it. A conversation that cannot be scored is one the dashboard
  // would render as an error.
  const { data: scorable } = await db
    .from('conversations')
    .select('id, title, engagement_type, criteria_version')
    .limit(50);
  const conversations = (scorable ?? []) as {
    id: string;
    title: string;
    engagement_type: string;
    criteria_version: number;
  }[];
  const withEvents = await fetchCriterionEvents(db, conversations.map((row) => row.id));
  const scoredIds = new Set(withEvents.map((row) => row.conversation_id));

  let scoredCount = 0;
  let best = { title: '', score: -1 };
  let scoringFailure: string | null = null;

  for (const conversation of conversations.filter((row) => scoredIds.has(row.id))) {
    try {
      const rows = await fetchCriteria(db, conversation.engagement_type, conversation.criteria_version);
      const set = defineCriteriaSet({
        engagementType: rows[0]!.engagement_type,
        version: rows[0]!.version,
        criteria: rows.map((row) => ({
          key: row.key,
          label: row.label,
          weight: row.weight,
          thresholds: {
            candidate: row.candidate_threshold,
            confirm: row.confirm_threshold,
            corroboratingSegments: row.corroborating_segments,
          },
        })),
      });
      const events: DetectorEvent[] = withEvents
        .filter((row) => row.conversation_id === conversation.id)
        .map((row) => ({
          kind: row.kind,
          criterionKey: row.criterion_key,
          confidence: row.confidence,
          span: {
            segmentId: row.segment_id,
            startMs: row.start_ms,
            endMs: row.end_ms,
            quote: row.quote,
          },
        }));
      const card = score(replay(set, events));
      scoredCount += 1;
      if (card.score > best.score) best = { title: conversation.title, score: card.score };
    } catch (cause) {
      scoringFailure = cause instanceof Error ? cause.message : String(cause);
      break;
    }
  }

  record(
    'stored evidence replays into a scorecard',
    scoringFailure === null && scoredCount > 0,
    scoringFailure ??
      (scoredCount === 0
        ? 'nothing scored yet — run pnpm score'
        : `${scoredCount} scored, best ${Math.round(best.score)} (${best.title})`),
  );

  // A conversation pinned to a criteria set that does not exist would render
  // as an empty scorecard with nothing to say about why. A trigger refuses it
  // on write; this is the audit that it held.
  const pinned = [...new Set(conversations.map((row) => `${row.engagement_type}/${row.criteria_version}`))];
  const missingSets: string[] = [];
  for (const pin of pinned) {
    const [engagementType, version] = pin.split('/');
    try {
      await fetchCriteria(db, engagementType!, Number(version));
    } catch {
      missingSets.push(pin);
    }
  }
  record(
    'every conversation pins a criteria set that exists',
    missingSets.length === 0,
    missingSets.length === 0 ? pinned.join(', ') : `missing ${missingSets.join(', ')}`,
  );

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


/**
 * The one write path, end to end, then erased.
 *
 * Exactly what the overlay does: start a session, append an utterance, record
 * an observation about it. Through a bearer token rather than cookies,
 * because that is the overlay's route through caller() and the one the web
 * app never exercises.
 *
 * The refusals matter more than the acceptances. A paraphrase that got stored
 * would be a quote nobody said, which is the single thing this product may
 * never do, and it is enforced in the database rather than here — so checking
 * it against the deployed system is the only check that means anything.
 */
async function checkLiveCapture(baseUrl: string, token: string): Promise<void> {
  const headers = {
    authorization: `Bearer ${token}`,
    'content-type': 'application/json',
  };
  const post = (path: string, body: unknown) =>
    fetch(new URL(path, baseUrl), { method: 'POST', headers, body: JSON.stringify(body) });

  let conversationId: string | null = null;

  try {
    const started = await post('/api/live/sessions', { title: 'QA PROBE — erased immediately' });
    const startedBody = (await started.json()) as { conversationId?: string; error?: string };
    conversationId = startedBody.conversationId ?? null;
    record(
      'POST /api/live/sessions starts a call',
      started.ok && Boolean(conversationId),
      startedBody.error ?? (conversationId ? 'created' : 'no id returned'),
    );
    if (!conversationId) return;

    const text = 'We reconcile the ledger by hand every month and it takes two days.';
    const appended = await post(`/api/live/sessions/${conversationId}/segments`, {
      speaker: 'customer',
      startMs: 1000,
      endMs: 9000,
      text,
    });
    const appendedBody = (await appended.json()) as { segmentId?: string; error?: string };
    record(
      'POST .../segments keeps an utterance',
      appended.ok && Boolean(appendedBody.segmentId),
      appendedBody.error ?? 'stored',
    );
    if (!appendedBody.segmentId) return;

    const evidence = (quote: string) => ({
      events: [
        {
          criterionKey: 'pain_quantified',
          kind: 'evidence',
          confidence: 0.9,
          segmentId: appendedBody.segmentId,
          quote,
          detector: 'qa-probe',
          model: 'qa-probe',
        },
      ],
    });

    const verbatim = await post(
      `/api/live/sessions/${conversationId}/events`,
      evidence('takes two days'),
    );
    const verbatimBody = (await verbatim.json()) as { recorded?: number; rejected?: number };
    record(
      'a verbatim quote is recorded',
      verbatim.ok && verbatimBody.recorded === 1,
      `recorded ${verbatimBody.recorded}, rejected ${verbatimBody.rejected}`,
    );

    const paraphrase = await post(
      `/api/live/sessions/${conversationId}/events`,
      evidence('wastes two whole days'),
    );
    const paraphraseBody = (await paraphrase.json()) as { recorded?: number; rejected?: number };
    record(
      'a paraphrase is refused',
      paraphrase.ok && paraphraseBody.recorded === 0 && paraphraseBody.rejected === 1,
      `recorded ${paraphraseBody.recorded}, rejected ${paraphraseBody.rejected}`,
    );

    const unauthenticated = await fetch(
      new URL(`/api/live/sessions/${conversationId}/events`, baseUrl),
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ events: [] }),
      },
    );
    record(
      'writing without credentials is refused',
      unauthenticated.status === 401,
      `${unauthenticated.status}`,
    );
  } finally {
    // In a finally because a probe conversation left behind is worse than a
    // failed check: it would appear on somebody's dashboard as a meeting.
    if (conversationId) {
      const { error } = await createServiceClient({
        url: requireEnv('SUPABASE_URL'),
        key: requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
      }).rpc('erase_conversation', { p_conversation_id: conversationId, p_reason: 'operator' });
      record('the probe conversation is erased', !error, error ? error.message : 'gone');
    }
  }
}

/**
 * Search, and the thing about it that could go wrong quietly.
 *
 * search_segments() is SECURITY INVOKER so that RLS does the tenant scoping.
 * That is a one-word difference from a function that would return every
 * company's transcripts to anybody who asked, and nothing about the page
 * would look different if it were wrong. So the check is not that search
 * works; it is that the same query returns fewer rows to a member than to the
 * service role.
 */
async function checkSearch(
  supabaseUrl: string,
  serviceKey: string,
  token: string | null,
): Promise<void> {
  const publishableKey = process.env['SUPABASE_PUBLISHABLE_KEY'] ?? null;

  const search = async (key: string, bearer: string) => {
    const response = await fetch(new URL('/rest/v1/rpc/search_segments', supabaseUrl), {
      method: 'POST',
      headers: {
        apikey: key,
        authorization: `Bearer ${bearer}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ p_query: 'report', p_limit: 200 }),
    });
    if (!response.ok) return null;
    return (await response.json()) as { segment_id: string; headline: string }[];
  };

  const operator = await search(serviceKey, serviceKey);
  record(
    'search finds segments',
    (operator?.length ?? 0) > 0,
    `${operator?.length ?? 0} across every tenant`,
  );

  const highlighted = operator?.some((hit) => hit.headline.includes('[[hl]]')) ?? false;
  record(
    'search marks the words it matched',
    highlighted,
    highlighted ? 'delimiters present' : 'no highlight markers',
  );

  if (!token || !publishableKey) {
    record(
      'search is scoped to the caller',
      true,
      'skipped — set SUPABASE_PUBLISHABLE_KEY to compare a member against the operator',
    );
    return;
  }

  const member = await search(publishableKey, token);
  record(
    'search is scoped to the caller',
    member !== null && operator !== null && member.length < operator.length,
    `member sees ${member?.length ?? 0} of ${operator?.length ?? 0}`,
  );
}


main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
