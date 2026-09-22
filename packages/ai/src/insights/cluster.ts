/**
 * Finding the signals that belong together.
 *
 * Retrieval narrows, the model decides. For each signal not yet covered, the
 * quote behind it is used as a similarity query through `retrieve()` — the one
 * guarded vector path (ADR 0004) — and the segments that come back are mapped
 * to the signals that cite them. That candidate set is what synthesis is
 * asked to judge.
 *
 * The alternative shapes were rejected for reasons worth keeping:
 *
 *   Embedding signal summaries would need a second vector store, a second
 *   thing to keep in step with the model that wrote it, and a second place
 *   for a tenant filter to go wrong.
 *
 *   Handing every signal to a model in one prompt works at ten signals and
 *   not at ten thousand, and gives a different answer each run.
 */
import type { SupabaseClient } from '@tesserafy/db';
import type { Embedder } from '../providers/embedder';
import { isCompanyId, type CompanyId } from '../retrieval/company-id';
import { retrieve } from '../retrieval/retrieve';

export interface ClusterableSignal {
  readonly id: string;
  readonly conversationId: string;
  readonly kind: string;
  readonly summary: string;
  /** The first quote behind this signal; the seed of its similarity query. */
  readonly quote: string;
}

export interface SignalCluster {
  readonly seed: ClusterableSignal;
  readonly signals: readonly ClusterableSignal[];
  readonly conversationIds: readonly string[];
}

export interface ClusterOptions {
  /** A service-role client. */
  readonly db: SupabaseClient;
  readonly embedder: Embedder;
  /** Cosine floor for a segment to be considered related. Default 0.6. */
  readonly minSimilarity?: number;
  /** Signals a cluster needs before it is worth synthesising. Default 3. */
  readonly minSignals?: number;
  /** Distinct conversations a cluster needs. Default 2. */
  readonly minConversations?: number;
  /** Segments to consider per seed. Default 20. */
  readonly limit?: number;
}

export interface LoadSignalsOptions {
  /**
   * Include signals that already back an insight. Default false.
   *
   * The default is what stops a second run writing the same finding twice.
   * Clustering is deterministic over unchanged data, so loading every signal
   * again produces the same cluster, pays for the same Opus call, and leaves
   * a person two near-identical insights to approve — the duplicate-ticket
   * failure, with a model call attached.
   *
   * True is for a deliberate re-synthesis after the prompt changes, where
   * producing the finding again is the point.
   */
  readonly includeCited?: boolean;
}

/**
 * Loads a company's signals with one quote each.
 *
 * Signals with no evidence cannot exist (the database refuses them), so every
 * row here has a quote to seed a query with.
 *
 * Signals already cited by an insight are left out by default. The tradeoff,
 * stated plainly: a new signal that belongs to an existing insight does not
 * join it — it waits until enough new signals accumulate to cluster on their
 * own. Growing an existing insight means re-opening a claim somebody may
 * already have approved and raised a ticket from, which is a larger decision
 * than this function should make on its own.
 */
export async function loadSignals(
  companyId: CompanyId,
  db: SupabaseClient,
  opts: LoadSignalsOptions = {},
): Promise<ClusterableSignal[]> {
  if (!isCompanyId(companyId)) {
    throw new TypeError('loadSignals() requires a valid companyId');
  }

  const { data: signals, error } = await db
    .from('signals')
    .select('id, conversation_id, kind, summary')
    .eq('company_id', companyId);
  if (error) throw new Error(`Loading signals failed: ${error.message}`, { cause: error });

  const rows = (signals ?? []) as {
    id: string;
    conversation_id: string;
    kind: string;
    summary: string;
  }[];
  if (rows.length === 0) return [];

  let cited = new Set<string>();
  if (!opts.includeCited) {
    const { data: citations, error: citedError } = await db
      .from('insight_evidence')
      .select('signal_id')
      .eq('company_id', companyId);
    if (citedError) {
      throw new Error(`Loading insight citations failed: ${citedError.message}`, {
        cause: citedError,
      });
    }
    cited = new Set(((citations ?? []) as { signal_id: string }[]).map((row) => row.signal_id));
  }

  const usable = rows.filter((row) => !cited.has(row.id));
  if (usable.length === 0) return [];

  const { data: evidence, error: evidenceError } = await db
    .from('signal_evidence')
    .select('signal_id, quote')
    .eq('company_id', companyId);
  if (evidenceError) {
    throw new Error(`Loading evidence failed: ${evidenceError.message}`, { cause: evidenceError });
  }

  const quoteFor = new Map<string, string>();
  for (const row of (evidence ?? []) as { signal_id: string; quote: string }[]) {
    if (!quoteFor.has(row.signal_id)) quoteFor.set(row.signal_id, row.quote);
  }

  return usable.map((row) => ({
    id: row.id,
    conversationId: row.conversation_id,
    kind: row.kind,
    summary: row.summary,
    quote: quoteFor.get(row.id) ?? row.summary,
  }));
}

/**
 * Groups a company's signals into candidate clusters.
 *
 * A signal joins at most one cluster: once covered it is not used as a seed
 * again, which stops the same finding being written as three near-identical
 * insights. Clusters that do not reach the thresholds are dropped rather than
 * synthesised — an "insight" drawn from one conversation is a signal.
 */
export async function clusterSignals(
  companyId: CompanyId,
  signals: readonly ClusterableSignal[],
  opts: ClusterOptions,
): Promise<SignalCluster[]> {
  if (!isCompanyId(companyId)) {
    throw new TypeError('clusterSignals() requires a valid companyId');
  }

  const minSignals = opts.minSignals ?? 3;
  const minConversations = opts.minConversations ?? 2;
  const byId = new Map(signals.map((signal) => [signal.id, signal]));
  const covered = new Set<string>();
  const clusters: SignalCluster[] = [];

  for (const seed of signals) {
    if (covered.has(seed.id)) continue;

    const segments = await retrieve(
      companyId,
      { text: seed.quote },
      {
        db: opts.db,
        embedder: opts.embedder,
        limit: opts.limit ?? 20,
        minSimilarity: opts.minSimilarity ?? 0.6,
      },
    );

    const relatedIds = await signalsCiting(
      companyId,
      segments.map((segment) => segment.segmentId),
      opts.db,
    );

    const members = [seed];
    for (const id of relatedIds) {
      if (id === seed.id || covered.has(id)) continue;
      const signal = byId.get(id);
      // Kind is part of identity: a problem and the feature request that would
      // solve it are related, and they are not the same finding.
      if (signal && signal.kind === seed.kind) members.push(signal);
    }

    const conversationIds = [...new Set(members.map((member) => member.conversationId))];
    if (members.length < minSignals || conversationIds.length < minConversations) continue;

    for (const member of members) covered.add(member.id);
    clusters.push({ seed, signals: members, conversationIds });
  }

  return clusters;
}

/** The signals citing any of these segments, tenant-scoped. */
async function signalsCiting(
  companyId: CompanyId,
  segmentIds: readonly string[],
  db: SupabaseClient,
): Promise<string[]> {
  if (segmentIds.length === 0) return [];

  const { data, error } = await db
    .from('signal_evidence')
    .select('signal_id')
    .eq('company_id', companyId)
    .in('segment_id', [...segmentIds]);
  if (error) throw new Error(`Loading citing signals failed: ${error.message}`, { cause: error });

  return [...new Set(((data ?? []) as { signal_id: string }[]).map((row) => row.signal_id))];
}
