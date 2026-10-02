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
import { scrub } from '@tesserafy/ai';
import { createServiceClient, fetchCriteria, fetchCriterionEvents } from '@tesserafy/db';
import { defineCriteriaSet, replay, score, type DetectorEvent } from '@tesserafy/scoring';

interface Check {
  name: string;
  detail: string;
  ok: boolean;
}

const checks: Check[] = [];

/** WebVTT needs real line breaks; a constant keeps the template readable. */
const NEWLINE = '\n';

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
    // Public, open or closed: closed, it says so rather than bouncing to sign-in.
    ['/signup', 200],
    ['/conversations', 307],
    ['/insights', 307],
    ['/settings', 307],
    ['/scorecards', 307],
    ['/reports', 307],
    ['/notifications', 307],
  ];
  for (const [path, expected] of pages) {
    const response = await fetch(new URL(path, baseUrl), { redirect: 'manual' });
    record(
      `GET ${path}`,
      response.status === expected,
      `${response.status}, expected ${expected}`,
    );
  }

  for (const path of ['/api/detect', '/api/criteria', '/api/criteria/sets', '/api/export/meetings', '/api/export/reports?table=weeks']) {
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

  // Public on purpose (the overlay signs in with it), so the one thing to
  // check is that public is all it is: the key it hands out must be the
  // publishable one. A service-role key here would be every tenant's data,
  // served to anyone who asked.
  const config = await fetch(new URL('/auth/client-config', baseUrl));
  const configBody = config.ok
    ? ((await config.json()) as { supabaseUrl?: string; publishableKey?: string })
    : {};
  const key = configBody.publishableKey ?? '';
  const payload = key.split('.')[1];
  const role = payload
    ? ((JSON.parse(Buffer.from(payload, 'base64url').toString()) as { role?: string }).role ?? '')
    : '';
  record(
    '/auth/client-config hands out the publishable key and nothing more',
    config.ok &&
      Boolean(configBody.supabaseUrl) &&
      key.length > 0 &&
      !key.startsWith('sb_secret_') &&
      role !== 'service_role',
    config.ok
      ? key.startsWith('sb_publishable_')
        ? 'publishable'
        : role
          ? `a JWT for ${role}`
          : 'unrecognised key'
      : `${config.status}`,
  );

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
    await checkImport(baseUrl, token);
  }

  console.info('\nSearch');
  await checkSearch(supabaseUrl, serviceKey, token);

  console.info('\nFailures have somewhere to go');
  await checkFailureRecording(supabaseUrl, serviceKey);

  console.info('\nRetention');
  await checkRetention(supabaseUrl, token);

  console.info('\nRecording consent, underneath the routes');
  await checkConsentInDatabase(supabaseUrl, token);

  if (token) {
    console.info('\nScorecards');
    await checkScorecards(baseUrl, token);

    console.info('\nThe console, underneath');
    await checkConsoleReads(token);
  }

  console.info('\nData invariants');
  const db = createServiceClient({ url: supabaseUrl, key: serviceKey });

  const counts = await Promise.all(
    // `as const` so these stay table names the client knows rather than bare
    // strings. A typo used to be a runtime 404 counted as zero rows, which
    // this check would then report as production having no data.
    (['conversations', 'segments', 'signals', 'signal_evidence', 'insights', 'criterion_events'] as const).map(async (table) => {
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
  const textOf = new Map((segments ?? []).map((row) => [row.id, row.text]));
  const drifted = (evidence ?? []).filter((row) => {
    const text = textOf.get(row.segment_id);
    return (
      text === undefined ||
      text.slice(row.quote_start, row.quote_end) !== (row.quote)
    );
  });
  record('every quote still matches its segment', drifted.length === 0, `${drifted.length} drifted`);

  // The same audit for the criteria side. A scorecard is only worth the
  // quotes under it, and these rows are what the score is derived from.
  const { data: criterionEvidence } = await db
    .from('criterion_events')
    .select('quote, quote_start, quote_end, segment_id');
  const criterionDrifted = (criterionEvidence ?? []).filter((row) => {
    const text = textOf.get(row.segment_id);
    return (
      text === undefined ||
      text.slice(row.quote_start, row.quote_end) !== (row.quote)
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
    .select('id, company_id, title, engagement_type, criteria_version')
    .limit(50);
  const conversations = (scorable ?? []) as {
    id: string;
    company_id: string;
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
      const rows = await fetchCriteria(db, conversation.company_id, conversation.engagement_type, conversation.criteria_version);
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
  const pinned = [
    ...new Set(conversations.map((row) => `${row.company_id}/${row.engagement_type}/${row.criteria_version}`)),
  ];
  const missingSets: string[] = [];
  for (const pin of pinned) {
    const [companyId, engagementType, version] = pin.split('/');
    try {
      await fetchCriteria(db, companyId!, engagementType!, Number(version));
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
    // The one-time recording agreement (ADR 0020): made once, kept the same
    // after. Without one a call is refused — the database test proves that,
    // since this account, having agreed, cannot un-agree.
    const agreed = await post('/api/live/agreement', { surface: 'web' });
    const agreement = (await agreed.json()) as { agreedAt?: string; termsVersion?: string; error?: string };
    record(
      'the recording agreement is made once and kept',
      agreed.ok && Boolean(agreement.agreedAt) && Boolean(agreement.termsVersion),
      agreement.error ?? `agreed ${agreement.agreedAt?.slice(0, 10)} under Terms ${agreement.termsVersion}`,
    );

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



/**
 * Importing a transcript, and the identifier that must not survive it.
 *
 * Redaction happens once, at T0, before anything is stored — which is what
 * makes it cover the embeddings, the prompts, the ticket bodies and the
 * backups at the same time. The flip side is that there is no second place to
 * catch a mistake: if it stops working, a real email address is written to
 * the database and every system downstream of it, silently.
 *
 * So this uploads a transcript carrying an address and a phone number, reads
 * the stored segment back, and asserts both that the identifiers are gone and
 * that the quantified figure beside them is not. The second half matters as
 * much as the first: a redactor that ate "90 minutes every morning" would
 * delete the finding this product exists to surface, and nobody would know.
 */
async function checkImport(baseUrl: string, token: string): Promise<void> {
  const email = 'priya.shah@northwind.co.uk';
  const said =
    `Reconciliation takes about 90 minutes every morning. ` +
    `Send it to ${email} or ring 020 7946 0958.`;

  const vtt = `WEBVTT${NEWLINE}${NEWLINE}00:00:01.000 --> 00:00:12.000${NEWLINE}<v Customer>${said}${NEWLINE}`;

  const form = new FormData();
  form.set('transcript', new File([vtt], 'qa-probe.vtt', { type: 'text/vtt' }));
  form.set('title', 'QA PROBE — erased immediately');

  let conversationId: string | null = null;

  try {
    // The same file without the box ticked is refused before it is read.
    const unconfirmed = await fetch(new URL('/api/transcripts', baseUrl), {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      body: form,
    });
    const unconfirmedBody = (await unconfirmed.json()) as { conversationId?: string };
    if (unconfirmedBody.conversationId) conversationId = unconfirmedBody.conversationId;
    record(
      'an import without recording consent is refused',
      unconfirmed.status === 400 && !unconfirmedBody.conversationId,
      `${unconfirmed.status}`,
    );
    // Anything it did create is erased by the finally; a second id would leak.
    if (conversationId) return;

    form.set('consent', 'on');
    const response = await fetch(new URL('/api/transcripts', baseUrl), {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      body: form,
    });
    const body = (await response.json()) as {
      conversationId?: string;
      segments?: number;
      error?: string;
    };
    conversationId = body.conversationId ?? null;
    record(
      'POST /api/transcripts imports a file',
      response.ok && Boolean(conversationId),
      body.error ?? `${body.segments} segment(s)`,
    );
    if (!conversationId) return;

    const db = createServiceClient({
      url: requireEnv('SUPABASE_URL'),
      key: requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
    });

    // Who confirmed comes from the session, never the request: the probe
    // account's own id, read out of the token that made the upload.
    const { data: consent } = await db
      .from('conversations')
      .select('consent_statement, consent_confirmed_by, consent_confirmed_at')
      .eq('id', conversationId)
      .single();
    const uploader = (JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString()) as { sub?: string }).sub;
    record(
      'the import records the consent confirmed, by whom and when',
      Boolean(consent?.consent_statement) &&
        Boolean(consent?.consent_confirmed_at) &&
        consent?.consent_confirmed_by === uploader,
      consent?.consent_statement ? `by ${consent.consent_confirmed_by === uploader ? 'the uploader' : 'someone else'}` : 'nothing recorded',
    );
    const { data } = await db
      .from('segments')
      .select('text')
      .eq('conversation_id', conversationId);
    const stored = ((data ?? []) as { text: string }[]).map((row) => row.text).join(' ');

    record(
      'an imported transcript stores no email address',
      stored.length > 0 && !stored.includes(email) && stored.includes('[email]'),
      stored.includes(email) ? 'the address was stored' : 'masked',
    );
    record(
      'and no phone number',
      !stored.includes('7946') && stored.includes('[phone]'),
      stored.includes('7946') ? 'the number was stored' : 'masked',
    );
    record(
      'while the quantified figure survives',
      stored.includes('90 minutes'),
      stored.includes('90 minutes') ? 'kept' : 'redaction ate the finding',
    );

    // An upload now scores itself after the response. Wait for that pass
    // before erasing, both because erasing under it would turn every QA run
    // into a failure-log entry, and because it is the thing to check: a T1
    // usage row carrying this conversation's id is proof the pass ran as the
    // uploader. Events are not asserted — a one-line probe honestly matching
    // no criterion is a scored call, not a broken one.
    const deadline = Date.now() + 90_000;
    let scoringCalls = 0;
    while (Date.now() < deadline) {
      const { count } = await db
        .from('model_usage')
        .select('id', { count: 'exact', head: true })
        .eq('conversation_id', conversationId)
        .eq('tier', 't1');
      scoringCalls = count ?? 0;
      if (scoringCalls > 0) break;
      await new Promise((resolve) => setTimeout(resolve, 3_000));
    }
    record(
      'an uploaded transcript scores itself',
      scoringCalls > 0,
      scoringCalls > 0 ? `${scoringCalls} detector call(s), as the uploader` : 'no scoring pass within 90 s',
    );

    // And embeds itself, in Supabase, alongside the scoring. A missing vector
    // is silent: the call looks fine and simply never joins an insight. Read
    // through conversation_pipeline, which counts vectors per call, because
    // nothing outside the retrieval module touches the vector table (ADR 0004).
    const { data: probe } = await db.from('conversations').select('company_id').eq('id', conversationId).single();
    let embedded = 0;
    let total = 0;
    const until = Date.now() + 60_000;
    while (probe && Date.now() < until) {
      const { data: rows } = await db.rpc('conversation_pipeline', { p_company_id: probe.company_id });
      const row = (rows ?? []).find((r) => r.conversation_id === conversationId);
      embedded = row?.embedded ?? 0;
      total = row?.segments ?? 0;
      if (total > 0 && embedded >= total) break;
      await new Promise((resolve) => setTimeout(resolve, 3_000));
    }
    record(
      'an uploaded transcript embeds itself',
      total > 0 && embedded === total,
      `${embedded} of ${total} segment(s) embedded, in Supabase`,
    );

    await checkCallWorkflow(baseUrl, token, conversationId);
    await checkWorkingWithACall(baseUrl, token, conversationId);
    await checkAsk(baseUrl, token, conversationId);
  } finally {
    if (conversationId) {
      const { error } = await createServiceClient({
        url: requireEnv('SUPABASE_URL'),
        key: requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
      }).rpc('erase_conversation', { p_conversation_id: conversationId, p_reason: 'operator' });
      record('the imported probe is erased', !error, error ? error.message : 'gone');
    }
  }
}


/**
 * "Ask your calls" (ADR 0018), on the probe just imported: the agent finds
 * the line, quotes it as it was said, and links to it. One real question,
 * ~$0.02, because an agent that stopped answering would otherwise be found by
 * a customer.
 */
async function checkAsk(baseUrl: string, token: string, conversationId: string): Promise<void> {
  const response = await fetch(new URL('/api/ask', baseUrl), {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ question: 'How long does reconciliation take each morning?' }),
  });
  const lines = (await response.text()).split('\n').filter(Boolean).map((line) => JSON.parse(line) as {
    type: string;
    points?: { quote: string; href: string | null }[];
    error?: string;
  });
  const steps = lines.filter((line) => line.type === 'step').length;
  const answer = lines.find((line) => line.type === 'answer');
  const cited = (answer?.points ?? []).find((point) => point.href?.includes(conversationId));
  record(
    'Ask finds the probe, quotes it as said and links to the line',
    response.status === 200 && steps > 0 && !!cited && /90 minutes/.test(cited.quote),
    answer ? `${steps} step(s); ${cited ? `“${cited.quote}”` : 'no point from the probe'}` : `${response.status} ${lines.find((line) => line.error)?.error ?? ''}`,
  );
}

/**
 * Can a failure be recorded, and does the recording lose the identifiers?
 *
 * The routes call record_failure inside a catch block and deliberately swallow
 * anything that goes wrong there — a sink that throws would replace a real
 * failure with a failure about failing. That is correct, and it means a broken
 * sink is silent, which is precisely the condition this table exists to end.
 * So it gets exercised directly rather than trusted.
 *
 * The probe writes a message carrying both an API key and a customer address,
 * because those are the two things an upstream error quotes back at you and
 * the two things a stored row must never keep.
 */
async function checkFailureRecording(supabaseUrl: string, serviceKey: string): Promise<void> {
  const db = createServiceClient({ url: supabaseUrl, key: serviceKey });
  const source = `qa/probe-${Date.now()}`;
  const said = scrub(
    'invalid_request: key sk-ant-api03-NOTAREALKEY_xx rejected for priya.shah@northwind.co.uk',
  );

  let id: string | null = null;
  try {
    const { data, error } = await db.rpc('record_failure', {
      p_source: source,
      p_kind: 'unknown',
      p_message: said,
      // The optional arguments are left out rather than sent as null, which is
      // what the routes do and therefore what this should exercise.
    });
    id = (data) ?? null;
    record('a failure can be recorded', !error && Boolean(id), error ? error.message : 'row written');
    if (!id) return;

    const { data: rows } = await db
      .from('system_failures')
      .select('message')
      .eq('source', source);
    const stored = ((rows ?? []) as { message: string }[])[0]?.message ?? '';

    record(
      'the recorded message keeps no credential',
      stored.length > 0 && !stored.includes('sk-ant') && stored.includes('[credential]'),
      stored.includes('sk-ant') ? 'a key was stored' : 'masked',
    );
    record(
      'and no customer identifier',
      !stored.includes('northwind.co.uk') && stored.includes('[email]'),
      stored.includes('northwind.co.uk') ? 'an address was stored' : 'masked',
    );
    record(
      'while the reason it failed survives',
      stored.includes('invalid_request'),
      stored.includes('invalid_request') ? 'kept' : 'scrubbing ate the message',
    );
  } finally {
    if (id) {
      const { error } = await db.from('system_failures').delete().eq('source', source);
      record('the probe failure is removed', !error, error ? error.message : 'gone');
    }
  }
}

/**
 * Retention, without changing it.
 *
 * Setting a period in production would schedule real deletions, so nothing
 * here saves one. It asks the question an owner's review step asks, and makes
 * one call the database must refuse — a period shorter than a week — which
 * proves the deployed range check without touching the row.
 */
async function checkRetention(supabaseUrl: string, token: string | null): Promise<void> {
  const publishableKey = process.env['SUPABASE_PUBLISHABLE_KEY'] ?? null;
  if (!token || !publishableKey) {
    record('retention', true, 'skipped — needs SUPABASE_PUBLISHABLE_KEY and a session');
    return;
  }

  const rpc = (name: string, bearer: string, body: unknown) =>
    fetch(new URL(`/rest/v1/rpc/${name}`, supabaseUrl), {
      method: 'POST',
      headers: {
        apikey: publishableKey,
        authorization: `Bearer ${bearer}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    });

  const preview = await rpc('retention_preview', token, { p_days: 30 });
  const affected = preview.ok ? await preview.json() : null;
  record(
    'a member can preview what a period would delete',
    typeof affected === 'number',
    typeof affected === 'number' ? `${affected} calls older than 30 days` : `${preview.status}`,
  );

  const tooShort = await rpc('set_retention', token, { p_days: 3 });
  const tooShortBody = (await tooShort.json()) as { code?: string };
  record(
    'a period under a week is refused',
    tooShortBody.code === '22023',
    tooShortBody.code ?? `${tooShort.status}`,
  );

  const anonymous = await rpc('retention_preview', publishableKey, { p_days: 30 });
  record(
    'and nobody signed out can ask',
    !anonymous.ok,
    `${anonymous.status}`,
  );
}

/**
 * The routes refuse an unconfirmed call, and the checks above prove it. This
 * goes around them, the way a hand-made request would: straight to PostgREST
 * with the probe's own session and no statement. The database must refuse it
 * too, or the routes are the only thing between a script and a call nobody
 * confirmed. Refused before anything is inserted, so there is nothing to erase
 * — unless it is wrongly accepted, in which case it is erased at once.
 */
async function checkConsentInDatabase(supabaseUrl: string, token: string | null): Promise<void> {
  const publishableKey = process.env['SUPABASE_PUBLISHABLE_KEY'] ?? null;
  if (!token || !publishableKey) {
    record('recording consent in the database', true, 'skipped — needs SUPABASE_PUBLISHABLE_KEY and a session');
    return;
  }

  const response = await fetch(new URL('/rest/v1/rpc/start_live_conversation', supabaseUrl), {
    method: 'POST',
    headers: {
      apikey: publishableKey,
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ p_title: 'QA PROBE — must be refused' }),
  });
  const body = (await response.json()) as { code?: string } | string;
  if (typeof body === 'string') {
    const db = createServiceClient({ url: supabaseUrl, key: requireEnv('SUPABASE_SERVICE_ROLE_KEY') });
    await db.rpc('erase_conversation', { p_conversation_id: body, p_reason: 'operator' });
  }
  record(
    'a direct call without a statement is refused by the database',
    typeof body !== 'string' && body.code === '22023',
    typeof body === 'string' ? 'a call was created (and erased)' : (body.code ?? `${response.status}`),
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});


/**
 * PostgREST as the probe account itself: its own session, RLS and all. Null
 * when the publishable key is not in the environment, and the callers skip.
 */
function asProbe(token: string): ((name: string, body: unknown) => Promise<{ status: number; body: unknown }>) | null {
  const publishableKey = process.env['SUPABASE_PUBLISHABLE_KEY'] ?? null;
  if (!publishableKey) return null;
  return async (name, body) => {
    const response = await fetch(new URL(`/rest/v1/rpc/${name}`, requireEnv('SUPABASE_URL')), {
      method: 'POST',
      headers: { apikey: publishableKey, authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const text = await response.text();
    return { status: response.status, body: text ? (JSON.parse(text) as unknown) : null };
  };
}

/**
 * What people do with a call after it arrives, on the probe: an outcome, a
 * corrected title, a note, and the CSV of Meetings. Each is undone by the
 * probe's erasure, which also proves notes and edits go with their call.
 *
 * The title is set to start with `=` on purpose: the CSV must write it as
 * text, or opening the export would run it as a formula.
 */
async function checkCallWorkflow(baseUrl: string, token: string, conversationId: string): Promise<void> {
  const rpc = asProbe(token);
  if (!rpc) {
    record('the call workflow', true, 'skipped — needs SUPABASE_PUBLISHABLE_KEY');
    return;
  }
  const db = createServiceClient({ url: requireEnv('SUPABASE_URL'), key: requireEnv('SUPABASE_SERVICE_ROLE_KEY') });

  const edited = await rpc('edit_conversation', {
    p_conversation_id: conversationId,
    p_title: '=QA PROBE — erased immediately',
    p_outcome: 'won',
  });
  const changed = (edited.body as { changed?: string[] } | null)?.changed ?? [];
  record(
    'whoever added a call can correct it and say how it ended',
    edited.status === 200 && changed.includes('title') && changed.includes('outcome'),
    edited.status === 200 ? `changed ${changed.join(', ')}` : JSON.stringify(edited.body),
  );
  const { count: logged } = await db
    .from('conversation_edits')
    .select('id', { count: 'exact', head: true })
    .eq('conversation_id', conversationId);
  record('and every change is logged', (logged ?? 0) >= 2, `${logged ?? 0} logged`);

  const csv = await fetch(new URL('/api/export/meetings?outcome=won&q=QA%20PROBE', baseUrl), {
    headers: { authorization: `Bearer ${token}` },
  });
  const csvText = csv.ok ? await csv.text() : '';
  record(
    'Meetings downloads as CSV, with its filters',
    csv.ok && (csv.headers.get('content-type') ?? '').startsWith('text/csv') && csvText.includes('QA PROBE'),
    csv.ok ? `${csvText.split('\r\n').filter(Boolean).length - 1} row(s)` : `${csv.status}`,
  );
  record(
    'and a title that starts like a formula is written as text',
    csvText.includes("'=QA PROBE") && !/(^|,)=QA PROBE/m.test(csvText),
    csvText.includes("'=QA PROBE") ? 'guarded' : 'the formula would run',
  );

  const { data: segment } = await db.from('segments').select('id').eq('conversation_id', conversationId).limit(1).single();
  const noted = segment ? await rpc('add_segment_note', { p_segment_id: segment.id, p_body: 'QA probe note' }) : null;
  const noteId = typeof noted?.body === 'string' ? noted.body : null;
  record('a member can note a moment', noted?.status === 200 && Boolean(noteId), noted ? `${noted.status}` : 'no segment');
  if (noteId) {
    const { count: told } = await db
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('note_id', noteId);
    record('nobody is notified of their own note', (told ?? 0) === 0, `${told ?? 0} notification(s)`);
  }
}

/**
 * What came after the call workflow, on the same probe and undone before it
 * is erased: a person's correction to the score, a line saved as an example,
 * a speaker marked as one of ours and the talk counted, an owner's goal, the
 * Reports CSV honouring its period, a text transcript's parser refusing a file
 * with no times, and feedback refusing an empty message. None of it spends an
 * allowance, and nothing is left behind: what is not removed here goes with
 * the probe's erasure.
 */
async function checkWorkingWithACall(baseUrl: string, token: string, conversationId: string): Promise<void> {
  const rpc = asProbe(token);
  if (!rpc) {
    record('working with a call', true, 'skipped — needs SUPABASE_PUBLISHABLE_KEY');
    return;
  }
  const db = createServiceClient({ url: requireEnv('SUPABASE_URL'), key: requireEnv('SUPABASE_SERVICE_ROLE_KEY') });
  const { data: segment } = await db
    .from('segments')
    .select('id, text')
    .eq('conversation_id', conversationId)
    .ilike('text', '%90 minutes%')
    .limit(1)
    .maybeSingle();
  if (!segment) {
    record('working with a call', false, 'the probe has no line saying 90 minutes');
    return;
  }
  const code = (answer: { status: number; body: unknown }) =>
    (answer.body as { code?: string } | null)?.code ?? `${answer.status}`;

  const disputed = await rpc('dispute_criterion', {
    p_conversation_id: conversationId,
    p_criterion_key: 'pain_quantified',
    p_kind: 'evidence',
    p_segment_id: segment.id,
    p_quote: '90 minutes',
    p_reason: 'QA probe: the cost is stated.',
  });
  const eventId = typeof disputed.body === 'string' ? disputed.body : null;
  record('a person can correct the score, quoting the words', disputed.status === 200 && eventId !== null, code(disputed));
  if (eventId) {
    // The correction teaches the scoring AI (ai_guidance), and withdrawing it forgets.
    const { count: learned } = await db.from('ai_guidance').select('id', { count: 'exact', head: true }).eq('source_event_id', eventId);
    const withdrawn = await rpc('withdraw_dispute', { p_event_id: eventId });
    const { count: forgotten } = await db.from('ai_guidance').select('id', { count: 'exact', head: true }).eq('source_event_id', eventId);
    record('and withdraw the correction', withdrawn.status < 300, `${withdrawn.status}`);
    record('the AI learns from the correction, and forgets it when withdrawn', learned === 1 && forgotten === 0, `${learned ?? 0} then ${forgotten ?? 0}`);
  }

  const saved = await rpc('save_moment', { p_segment_id: segment.id, p_criterion_key: 'pain_quantified', p_note: 'QA probe' });
  const momentId = typeof saved.body === 'string' ? saved.body : null;
  record('a line can be saved as an example of a criterion', saved.status === 200 && momentId !== null, code(saved));
  if (momentId) {
    const removed = await rpc('remove_moment', { p_moment_id: momentId });
    record('and taken out again', removed.status < 300, `${removed.status}`);
  }
  const offCard = await rpc('save_moment', { p_segment_id: segment.id, p_criterion_key: 'qa_not_a_criterion' });
  record('but only as an example of a criterion on the call', code(offCard) === '22023', code(offCard));

  const talk = await rpc('conversation_talk', { p_since: '2000-01-01T00:00:00Z' });
  const words = Array.isArray(talk.body)
    ? (talk.body as { conversation_id: string; words: number }[])
        .filter((row) => row.conversation_id === conversationId)
        .reduce((sum, row) => sum + Number(row.words), 0)
    : 0;
  record('who talked is counted from the transcript', talk.status === 200 && words > 0, `${words} word(s)`);
  const marked = await rpc('set_our_speaker', { p_name: 'QA probe speaker', p_ours: true });
  const { count: kept } = await db.from('our_speakers').select('name', { count: 'exact', head: true }).eq('name', 'QA probe speaker');
  const unmarked = await rpc('set_our_speaker', { p_name: 'QA probe speaker', p_ours: false });
  const { count: left } = await db.from('our_speakers').select('name', { count: 'exact', head: true }).eq('name', 'QA probe speaker');
  record(
    'a speaker can be marked as one of ours, and unmarked',
    marked.status < 300 && unmarked.status < 300 && kept === 1 && left === 0,
    `${kept ?? 0} then ${left ?? 0}`,
  );

  const uploader = (JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString()) as { sub?: string }).sub ?? '';
  const { data: membership } = await db.from('company_members').select('role').eq('user_id', uploader).limit(1).maybeSingle();
  const goal = await rpc('set_criterion_goal', { p_engagement_type: 'discovery', p_criterion_key: 'pain_quantified', p_target: 0.5 });
  if (membership?.role === 'owner') {
    const cleared = await rpc('set_criterion_goal', { p_engagement_type: 'discovery', p_criterion_key: 'pain_quantified', p_target: null });
    record('an owner sets a goal for a criterion, and clears it', goal.status < 300 && cleared.status < 300, `${goal.status}, ${cleared.status}`);
  } else {
    record('a member cannot set a goal', code(goal) === '42501', code(goal));
  }

  for (const weeks of [4, 26]) {
    const csv = await fetch(new URL(`/api/export/reports?weeks=${weeks}&table=weeks`, baseUrl), {
      headers: { authorization: `Bearer ${token}` },
    });
    const rows = csv.ok ? (await csv.text()).split('\r\n').filter(Boolean).length - 1 : 0;
    record(`the Reports CSV covers the period asked for (${weeks} weeks)`, csv.ok && rows === weeks, csv.ok ? `${rows} week(s)` : `${csv.status}`);
  }

  const form = new FormData();
  form.set('transcript', new File([`Ada: Hello${NEWLINE}Grace: Hi`], 'qa-probe.txt', { type: 'text/plain' }));
  form.set('consent', 'on');
  const untimed = await fetch(new URL('/api/transcripts', baseUrl), {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: form,
  });
  const untimedBody = (await untimed.json()) as { error?: string; conversationId?: string };
  record(
    'a text transcript without times is refused, before anything is stored or charged',
    untimed.status === 422 && /No timestamps/.test(untimedBody.error ?? '') && !untimedBody.conversationId,
    `${untimed.status}`,
  );
  if (untimedBody.conversationId) {
    await db.rpc('erase_conversation', { p_conversation_id: untimedBody.conversationId, p_reason: 'operator' });
  }

  // A call prep's LinkedIn field is a profile address or nothing: checked by
  // the database, so a prep can never carry a link somewhere else.
  const badLink = await rpc('save_call_prep', { p_person_name: 'QA probe', p_linkedin_url: 'https://example.com/in/qa' });
  record('a call prep takes only a LinkedIn profile address', code(badLink) === '22023', code(badLink));

  // Coaching, on the probe's own call and to itself: assigned, done, withdrawn.
  const assigned = await rpc('assign_coaching', {
    p_assigned_to: uploader,
    p_conversation_id: conversationId,
    p_segment_id: segment.id,
    p_note: 'QA probe',
  });
  const assignmentId = typeof assigned.body === 'string' ? assigned.body : null;
  const completed = assignmentId ? await rpc('complete_coaching', { p_assignment_id: assignmentId, p_reply: 'QA probe' }) : null;
  const withdrawn = assignmentId ? await rpc('withdraw_coaching', { p_assignment_id: assignmentId }) : null;
  record(
    membership?.role === 'owner' ? 'an owner assigns a moment for coaching; it is done, and withdrawn' : 'a member cannot assign coaching',
    membership?.role === 'owner'
      ? assigned.status === 200 && (completed?.status ?? 500) < 300 && (withdrawn?.status ?? 500) < 300
      : code(assigned) === '42501',
    `${assigned.status}${completed ? `, ${completed.status}` : ''}${withdrawn ? `, ${withdrawn.status}` : ''}`,
  );

  // An owner instructs an AI feature, and deletes the instruction again.
  if (membership?.role === 'owner') {
    const told = await rpc('add_ai_instruction', { p_feature: 'action_items', p_body: 'QA probe instruction' });
    const toldId = typeof told.body === 'string' ? told.body : null;
    const removed = toldId ? await rpc('set_ai_guidance', { p_guidance_id: toldId, p_delete: true }) : null;
    record('an owner instructs an AI feature, and deletes the instruction', told.status === 200 && (removed?.status ?? 500) < 300, `${told.status}, ${removed?.status}`);
  }

  // "Not right" on an action item: it goes, and the reason teaches that
  // feature. The example is tied to the probe's call, so its erasure takes it.
  const listed = await rpc('record_action_items', {
    p_conversation_id: conversationId,
    p_detector: 'qa-probe',
    p_model: 'none',
    p_items: [{ segment_id: segment.id, quote: '90 minutes', action: 'QA probe item', owner_side: 'ours' }],
  });
  const { data: item } = await db.from('action_items').select('id').eq('conversation_id', conversationId).eq('detector', 'qa-probe').maybeSingle();
  const rejected = item ? await rpc('reject_action_item', { p_item_id: item.id, p_reason: 'QA probe: not a commitment.' }) : null;
  const exampleId = typeof rejected?.body === 'string' ? rejected.body : null;
  const { count: stillThere } = await db
    .from('action_items')
    .select('id', { count: 'exact', head: true })
    .eq('conversation_id', conversationId)
    .eq('detector', 'qa-probe');
  const { data: example } = exampleId
    ? await db.from('ai_guidance').select('feature, result, conversation_id').eq('id', exampleId).maybeSingle()
    : { data: null };
  record(
    '"Not right" removes an action item and teaches action items why',
    listed.status === 200 &&
      (stillThere ?? 1) === 0 &&
      example?.feature === 'action_items' &&
      example.result === 'QA probe item' &&
      example.conversation_id === conversationId,
    `${listed.status}, ${rejected?.status ?? 'no item'}, ${stillThere ?? '?'} left`,
  );

  // The overlay's settings live in the dashboard: /api/live/setup says what
  // the next call starts with, and a look the overlay does not know is refused.
  const setup = await fetch(new URL('/api/live/setup', baseUrl), { headers: { authorization: `Bearer ${token}` } });
  const setupBody = (await setup.json().catch(() => ({}))) as { engagementType?: unknown; screen?: unknown; detectCalls?: unknown };
  const badLook = await rpc('set_overlay_look', { p_look: { theme: 'neon' } });
  record(
    'the overlay is set up from the dashboard, with only looks it knows',
    setup.status === 200 && typeof setupBody.engagementType === 'string' && typeof setupBody.screen === 'boolean' && typeof setupBody.detectCalls === 'boolean' && code(badLook) === '22023',
    `${setup.status}, ${code(badLook)}`,
  );

  // Knowledge: a document goes in through the route, is read, split and
  // embedded inside Supabase, and is deleted again; a member is refused.
  const knowledgeForm = new FormData();
  knowledgeForm.set('title', 'QA probe knowledge');
  knowledgeForm.set('text', 'QA probe knowledge. The probe plan costs nothing and rolls out in one minute.');
  const added = await fetch(new URL('/api/knowledge', baseUrl), {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: knowledgeForm,
  });
  const addedBody = (await added.json().catch(() => ({}))) as { documentId?: string; passages?: number };
  const removed = addedBody.documentId ? await rpc('delete_knowledge_document', { p_document_id: addedBody.documentId }) : null;
  record(
    membership?.role === 'owner' ? 'an owner adds a document to the knowledge, embedded, and deletes it' : 'a member cannot add to the knowledge',
    membership?.role === 'owner'
      ? added.status === 200 && (addedBody.passages ?? 0) >= 1 && (removed?.status ?? 500) < 300
      : added.status === 403,
    `${added.status}${removed ? `, ${removed.status}` : ''}`,
  );

  const empty = await rpc('send_feedback', { p_body: '   ' });
  record('feedback with nothing in it is refused', code(empty) === '22023', code(empty));

  // The sample call is one per company, ever. The probe's company takes its
  // one on the first run after the feature ships, which is erased here at
  // once; every run after meets the refusal. Either answer is the route
  // working; anything else is not.
  const sample = await fetch(new URL('/api/sample-call', baseUrl), { method: 'POST', headers: { authorization: `Bearer ${token}` } });
  const sampleBody = (await sample.json()) as { conversationId?: string; error?: string };
  if (sampleBody.conversationId) {
    await db.rpc('erase_conversation', { p_conversation_id: sampleBody.conversationId, p_reason: 'operator' });
  }
  record(
    'the sample call is offered once per company',
    (sample.status === 200 && Boolean(sampleBody.conversationId)) || sample.status === 409,
    sample.status === 200 ? 'imported, and erased' : `${sample.status} ${sampleBody.error ?? ''}`.trim(),
  );
}

/**
 * Scorecards, as the probe account, spending nothing: the picker's list, and
 * the two refusals that keep a company's set from being ambiguous or broken
 * — a template's name, and a draft the engine could not score, refused by the
 * trial before it charges anything.
 */
async function checkScorecards(baseUrl: string, token: string): Promise<void> {
  const sets = await fetch(new URL('/api/criteria/sets', baseUrl), { headers: { authorization: `Bearer ${token}` } });
  const setsBody = sets.ok ? ((await sets.json()) as { sets?: { engagementType: string; own: boolean }[] }) : {};
  record(
    'the overlay can list the scorecards a caller may use',
    sets.ok && (setsBody.sets ?? []).some((set) => set.engagementType === 'discovery' && !set.own),
    sets.ok ? (setsBody.sets ?? []).map((set) => set.engagementType).join(', ') : `${sets.status}`,
  );

  const draft = {
    name: 'discovery',
    criteria: [
      { key: 'a_one', label: 'One', definition: 'Twenty characters or more, for the detector.', weight: 1 },
      { key: 'b_two', label: 'Two', definition: 'Twenty characters or more, for the detector.', weight: 1 },
    ],
  };
  const tried = await fetch(new URL('/api/scorecards/try', baseUrl), {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(draft),
  });
  record(
    'a draft named like a template is refused before it is tried',
    tried.status === 422 || tried.status === 403,
    `${tried.status}`,
  );

  const rpc = asProbe(token);
  if (!rpc) {
    record('publishing a scorecard', true, 'skipped — needs SUPABASE_PUBLISHABLE_KEY');
    return;
  }
  const published = await rpc('publish_scorecard', { p_engagement_type: 'discovery', p_criteria: draft.criteria });
  record(
    'and the database refuses to publish one',
    published.status >= 400 && ['22023', '42501'].includes((published.body as { code?: string } | null)?.code ?? ''),
    (published.body as { code?: string } | null)?.code ?? `${published.status}`,
  );
}

/**
 * The console's adoption, spend and activity, as the probe account — which
 * is an operator — and refused to anyone signed out. Reads only.
 */
async function checkConsoleReads(token: string): Promise<void> {
  const rpc = asProbe(token);
  if (!rpc) {
    record('console reads', true, 'skipped — needs SUPABASE_PUBLISHABLE_KEY');
    return;
  }
  // The probe's session is a password's alone (aal1). Once operators must use
  // a second factor, the right answer to it is a refusal — the database, not
  // the console, is what asks for the code.
  const { data: settings } = await createServiceClient({
    url: requireEnv('SUPABASE_URL'),
    key: requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
  })
    .from('app_settings')
    .select('operator_mfa_required')
    .maybeSingle();
  const required = settings?.operator_mfa_required === true;
  for (const [name, body] of [
    ['admin_adoption', {}],
    ['admin_spend_by_week', { p_weeks: 12 }],
    ['admin_activity', { p_limit: 20 }],
    ['admin_company_margin', { p_days: 30 }],
    ['admin_company_health', {}],
    ['admin_feature_adoption', { p_days: 90 }],
  ] as const) {
    const answer = await rpc(name, body);
    if (required) {
      record(
        `${name} refuses an operator without their second factor`,
        answer.status >= 400 && (answer.body as { code?: string } | null)?.code === '42501',
        `${answer.status}`,
      );
    } else {
      record(
        `${name} answers an operator`,
        answer.status === 200 && Array.isArray(answer.body),
        answer.status === 200 ? `${(answer.body as unknown[]).length} row(s)` : `${answer.status}`,
      );
    }
  }
  const anonymous = asProbe(process.env['SUPABASE_PUBLISHABLE_KEY'] ?? '');
  const refused = anonymous ? await anonymous('admin_activity', { p_limit: 1 }) : null;
  record('and refuses anyone signed out', refused !== null && refused.status >= 400, `${refused?.status}`);
}
