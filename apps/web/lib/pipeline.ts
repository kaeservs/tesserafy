import type { SupabaseClient } from '@tesserafy/db';

/**
 * Where each conversation has got to.
 *
 * An imported transcript arrives with every stage done at once, so the
 * difference never showed. A live-captured call does not: it has segments and
 * criterion events and nothing else, which looks identical to a finished call
 * with a low score. Those are opposite facts — "this went badly" and "nobody
 * has run the pass yet" — and the product was rendering them the same.
 *
 * Counts come from one database function. The page never names the embeddings
 * table, which ADR 0004's guard forbids and which is the right prohibition: a
 * page that could query it is a page that could query it wrongly. It learns
 * whether a call is searchable, never what it contains.
 */

export interface PipelineState {
  readonly segments: number;
  readonly embedded: number;
  readonly signals: number;
  readonly criterionRows: number;
  /** How many times extraction has run, from the usage telemetry. */
  readonly extractionRuns: number;
}

export type PipelineStage = 'empty' | 'captured' | 'scored' | 'processed';

interface PipelineRow {
  conversation_id: string;
  segments: number;
  embedded: number;
  signals: number;
  criterion_rows: number;
  extraction_runs: number;
}

export async function conversationPipeline(
  db: SupabaseClient,
): Promise<Map<string, PipelineState>> {
  // No argument: the function scopes itself to the caller. Passing null said
  // the same thing and read like "every company", which it never was.
  const { data, error } = await db.rpc('conversation_pipeline', {});
  if (error) {
    throw new Error(`Could not read pipeline state: ${error.message}`);
  }

  return new Map(
    ((data ?? []) as PipelineRow[]).map((row) => [
      row.conversation_id,
      {
        segments: row.segments,
        embedded: row.embedded,
        signals: row.signals,
        criterionRows: row.criterion_rows,
        extractionRuns: row.extraction_runs,
      },
    ]),
  );
}

/**
 * The furthest stage a conversation has reached.
 *
 * Deliberately the *furthest*, not a checklist: a reader wants one word for
 * where a call stands, and the detail is on the conversation page for whoever
 * needs to act on it.
 */
export function stageOf(state: PipelineState | undefined): PipelineStage {
  if (!state || state.segments === 0) return 'empty';

  // Extraction and embedding happen in the same pass, so signals without
  // embeddings would mean an interrupted run — worth showing as unfinished
  // rather than done.
  const searchable = state.embedded >= state.segments;
  // Finding nothing is a finished state, not a pending one. A check-in where
  // the customer says everything is fine has no signals and never will, and
  // flagging it forever would also re-extract it on Opus forever.
  const extracted = state.signals > 0 || state.extractionRuns > 0;
  if (extracted && searchable) return 'processed';

  if (state.criterionRows > 0) return 'scored';
  return 'captured';
}

/** What to run next, in the words the operator would type. */
export function nextCommand(stage: PipelineStage, conversationId: string): string | null {
  switch (stage) {
    case 'captured':
      return `pnpm score --conversation ${conversationId}`;
    case 'scored':
      return `pnpm process --conversation ${conversationId}`;
    default:
      return null;
  }
}
