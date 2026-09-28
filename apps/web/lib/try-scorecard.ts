import Anthropic from '@anthropic-ai/sdk';
import {
  awaitableDatabaseSink,
  scanWindows,
  T1_DETECTOR,
  windowCount,
  windowsOf,
  type ScanOptions,
  type StoredSegment,
} from '@tesserafy/ai';
import type { SupabaseClient } from '@tesserafy/db';
import {
  defineCriteriaSet,
  replay,
  score,
  type CriterionStatus,
  type DetectorEvent,
} from '@tesserafy/scoring';
import type { DraftCriterion } from './scorecard-draft';

/**
 * A draft scorecard, run over a company's recent calls, writing nothing.
 *
 * A criterion's description is a prompt. Publishing one without running it is
 * shipping a prompt blind: it validates, and it may still detect nothing,
 * because the words do not describe anything a customer says out loud. So the
 * editor asks the question the operator's `pnpm criteria --try` asks — how
 * often does each criterion land, across calls that are not alike — against
 * the company's own calls, as the owner, through their RLS client.
 *
 * The same windows and detector as an import (ADR 0014), so what a trial shows
 * is what publishing would produce. Nothing is stored: no criterion events, no
 * scores. The model calls are recorded like any other, because a trial costs
 * money too and cost telemetry that skipped experiments would understate what
 * getting a scorecard right took.
 */

/** Calls tried at most. Several, because one call teaches a draft that call. */
export const TRY_MAX_CALLS = 3;

/**
 * Detector windows per trial, across all its calls: about three hour-long
 * meetings, ~$0.17 at the measured ~$0.011 a window. A trial is charged as one
 * imported call, and an imported call may cost up to ~$0.45, so a trial never
 * costs more than what it is charged as.
 */
export const TRY_MAX_WINDOWS = 15;

/** The candidates looked at to find calls that fit. */
const LOOK_BACK = 12;

const CONCURRENCY = 8;

export interface TriedCriterion {
  readonly key: string;
  readonly label: string;
  readonly status: CriterionStatus;
  /** The strongest span, verbatim from the transcript, when there is one. */
  readonly quote: string | null;
  readonly confidence: number | null;
  readonly atMs: number | null;
}

export interface TriedCall {
  readonly id: string;
  readonly title: string;
  readonly occurredAt: string | null;
  readonly score: number;
  readonly criteria: readonly TriedCriterion[];
}

export type TryOutcome =
  | { readonly status: 'tried'; readonly calls: readonly TriedCall[]; readonly windows: number; readonly rejected: number }
  | { readonly status: 'no_calls' };

interface Candidate {
  id: string;
  title: string;
  occurred_at: string | null;
  segments: { count: number }[];
}

/**
 * The most recent calls whose windows fit the budget together. A call too long
 * to fit is passed over rather than tried in part: a scorecard over the first
 * half of a meeting reads as complete and is not.
 */
export function chooseCalls<T extends { segments: number }>(candidates: readonly T[]): T[] {
  const chosen: T[] = [];
  let windows = 0;
  for (const candidate of candidates) {
    if (chosen.length >= TRY_MAX_CALLS) break;
    if (candidate.segments === 0) continue;
    const needed = windowCount(candidate.segments);
    if (windows + needed > TRY_MAX_WINDOWS) continue;
    chosen.push(candidate);
    windows += needed;
  }
  return chosen;
}

export async function tryScorecard(
  db: SupabaseClient,
  companyId: string,
  draft: { name: string; criteria: readonly DraftCriterion[] },
  client: Anthropic = new Anthropic(),
  /** The detector. Replaced in tests; the product's T1 otherwise. */
  detect?: ScanOptions['detect'],
): Promise<TryOutcome> {
  // Validated by the same function every loaded set goes through, so a draft
  // the engine would refuse is refused before any model is asked.
  const criteriaSet = defineCriteriaSet({
    engagementType: draft.name,
    version: 1,
    criteria: draft.criteria.map((criterion) => ({
      key: criterion.key,
      label: criterion.label,
      weight: criterion.weight,
    })),
  });
  const prompts = draft.criteria.map((criterion) => ({
    key: criterion.key,
    label: criterion.label,
    definition: criterion.definition,
  }));

  const { data, error } = await db
    .from('conversations')
    .select('id, title, occurred_at, segments(count)')
    .eq('company_id', companyId)
    .order('occurred_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .limit(LOOK_BACK);
  if (error) throw new Error(`Reading recent calls failed: ${error.message}`);

  const chosen = chooseCalls(
    ((data ?? []) as unknown as Candidate[]).map((row) => ({ ...row, segments: row.segments[0]?.count ?? 0 })),
  );
  if (chosen.length === 0) return { status: 'no_calls' };

  let windowsRun = 0;
  let rejected = 0;
  const calls = await Promise.all(
    chosen.map(async (call): Promise<TriedCall> => {
      const { data: rows, error: segmentsError } = await db
        .from('segments')
        .select('id, speaker, start_ms, end_ms, text')
        .eq('conversation_id', call.id)
        .order('start_ms', { ascending: true });
      if (segmentsError) throw new Error(`Reading a transcript failed: ${segmentsError.message}`);
      const segments = (rows ?? []) as StoredSegment[];
      const byId = new Map(segments.map((segment) => [segment.id, segment]));

      const windows = windowsOf(segments);
      const usage = awaitableDatabaseSink({
        db,
        detector: `${T1_DETECTOR}-try`,
        companyId,
        conversationId: call.id,
      });
      const scan = await scanWindows(windows, {
        client,
        criteria: prompts,
        concurrency: CONCURRENCY,
        onUsage: usage.sink,
        ...(detect ? { detect } : {}),
      });
      await usage.settled();
      windowsRun += scan.calls;
      rejected += scan.rejected;

      // The detector has already refused any quote not in its window; this
      // attaches the timing the scoring engine and the page need.
      const events: DetectorEvent[] = [];
      for (const event of scan.events) {
        const segment = byId.get(event.segmentId);
        if (!segment) continue;
        events.push({
          kind: event.kind,
          criterionKey: event.criterionKey,
          confidence: event.confidence,
          span: { segmentId: segment.id, startMs: segment.start_ms, endMs: segment.end_ms, quote: event.quote },
        });
      }

      const card = score(replay(criteriaSet, events));
      return {
        id: call.id,
        title: call.title,
        occurredAt: call.occurred_at,
        score: card.score,
        criteria: card.criteria.map((criterion) => {
          const best = [...criterion.evidence].sort((a, b) => b.confidence - a.confidence)[0];
          return {
            key: criterion.key,
            label: criterion.label,
            status: criterion.status,
            quote: best?.span.quote ?? null,
            confidence: best?.confidence ?? null,
            atMs: best?.span.startMs ?? null,
          };
        }),
      };
    }),
  );

  return { status: 'tried', calls, windows: windowsRun, rejected };
}
