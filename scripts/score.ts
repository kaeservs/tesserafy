/**
 * Score stored conversations against their criteria set.
 *
 *   pnpm score --company <uuid>            every unscored conversation
 *   pnpm score --conversation <uuid>       one, by id
 *   pnpm score --company <uuid> --rescore  including ones already scored
 *   pnpm score --company <uuid> --dry-run  detect, print, write nothing
 *
 * This is the pass that gives a past meeting a scorecard. It runs T1 over the
 * stored segments in the same rolling windows the live path uses, and writes
 * the resulting DetectorEvents to `criterion_events`. It does not write a
 * score: the score is computed on read by packages/scoring, from these rows
 * (invariant 1).
 *
 * Windows overlap, and that is deliberate rather than tolerated. A criterion
 * is often established across two utterances — a complaint in one, its cost in
 * the next — and a detector that only ever saw disjoint windows would miss
 * exactly the evidence the corroboration threshold exists to reward. Latching
 * (invariant 2) plus the uniqueness constraint on (conversation, criterion,
 * kind, segment, offsets) makes the repeats free: the same span observed twice
 * is stored once and would not double-count if it were not.
 *
 * It costs money. Every window is a Haiku call, so the count is printed before
 * anything is sent and --dry-run exists to see it without paying for it.
 */
import Anthropic from '@anthropic-ai/sdk';
import {
  databaseSink,
  detectCriteria,
  locate,
  T1_DETECTOR,
  type CriterionPrompt,
  type DetectableSegment,
} from '@tesserafy/ai';
import { createServiceClient, fetchCriteria, type SupabaseClient } from '@tesserafy/db';

/** Utterances per window, matching the live path. */
const WINDOW_SIZE = 3;
/** How far the window advances. Two of three utterances are re-shown. */
const STRIDE = 1;

interface ConversationRow {
  id: string;
  company_id: string;
  title: string;
  engagement_type: string;
  criteria_version: number;
}

interface SegmentRow {
  id: string;
  speaker: string | null;
  start_ms: number;
  end_ms: number;
  text: string;
}

function flag(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`score: ${name} is not set`);
    process.exit(2);
  }
  return value;
}

/**
 * Which conversations to work on.
 *
 * "Unscored" means no criterion_events at all, not "fewer than expected" — a
 * conversation where the detector honestly found nothing is scored, and
 * re-running it every night would cost money to reconfirm a zero.
 */
async function chooseConversations(
  db: SupabaseClient,
  opts: { companyId?: string; conversationId?: string; rescore: boolean },
): Promise<ConversationRow[]> {
  let query = db
    .from('conversations')
    .select('id, company_id, title, engagement_type, criteria_version')
    .order('occurred_at', { ascending: true });

  if (opts.conversationId) query = query.eq('id', opts.conversationId);
  if (opts.companyId) query = query.eq('company_id', opts.companyId);

  const { data, error } = await query;
  if (error) throw new Error(`Listing conversations failed: ${error.message}`);
  const conversations = (data ?? []) as ConversationRow[];
  if (conversations.length === 0 || opts.rescore) return conversations;

  const { data: scored, error: scoredError } = await db
    .from('criterion_events')
    .select('conversation_id')
    .in('conversation_id', conversations.map((row) => row.id));
  if (scoredError) throw new Error(`Reading existing events failed: ${scoredError.message}`);

  const already = new Set(((scored ?? []) as { conversation_id: string }[]).map((r) => r.conversation_id));
  return conversations.filter((conversation) => !already.has(conversation.id));
}

async function segmentsOf(db: SupabaseClient, conversationId: string): Promise<SegmentRow[]> {
  const { data, error } = await db
    .from('segments')
    .select('id, speaker, start_ms, end_ms, text')
    .eq('conversation_id', conversationId)
    .order('start_ms', { ascending: true });
  if (error) throw new Error(`Reading segments failed: ${error.message}`);
  return (data ?? []) as SegmentRow[];
}

function windowsOf(segments: readonly SegmentRow[]): DetectableSegment[][] {
  const windows: DetectableSegment[][] = [];
  for (let start = 0; start < segments.length; start += STRIDE) {
    const slice = segments.slice(start, start + WINDOW_SIZE);
    if (slice.length === 0) break;
    windows.push(
      slice.map((segment) => ({
        id: segment.id,
        speaker: segment.speaker,
        startMs: segment.start_ms,
        endMs: segment.end_ms,
        text: segment.text,
      })),
    );
    // The last window is whatever is left; advancing past it would repeat it.
    if (start + WINDOW_SIZE >= segments.length) break;
  }
  return windows;
}

interface PendingEvent {
  company_id: string;
  conversation_id: string;
  criterion_key: string;
  kind: 'evidence' | 'contradiction';
  confidence: number;
  segment_id: string;
  quote: string;
  quote_start: number;
  quote_end: number;
  detector: string;
  model: string;
}

async function main(): Promise<void> {
  const companyId = flag('--company');
  const conversationId = flag('--conversation');
  const rescore = process.argv.includes('--rescore');
  const dryRun = process.argv.includes('--dry-run');

  if (!companyId && !conversationId) {
    console.error('usage: pnpm score --company <uuid> | --conversation <uuid> [--rescore] [--dry-run]');
    process.exit(2);
  }
  if (!dryRun && !process.env['ANTHROPIC_API_KEY']) {
    console.error('score: ANTHROPIC_API_KEY is not set');
    process.exit(2);
  }

  const db = createServiceClient({
    url: requireEnv('SUPABASE_URL'),
    key: requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
  });

  const conversations = await chooseConversations(db, {
    ...(companyId ? { companyId } : {}),
    ...(conversationId ? { conversationId } : {}),
    rescore,
  });

  if (conversations.length === 0) {
    console.info('Nothing to score. Everything already has events — pass --rescore to redo them.');
    return;
  }

  // The bill, before any of it is spent.
  const plan: { conversation: ConversationRow; windows: DetectableSegment[][] }[] = [];
  for (const conversation of conversations) {
    const segments = await segmentsOf(db, conversation.id);
    if (segments.length === 0) continue;
    plan.push({ conversation, windows: windowsOf(segments) });
  }

  const calls = plan.reduce((sum, entry) => sum + entry.windows.length, 0);
  console.info(
    `${plan.length} conversation(s), ${calls} detector call(s) at ${WINDOW_SIZE} utterances per window.`,
  );
  if (dryRun) {
    for (const { conversation, windows } of plan) {
      console.info(`  ${conversation.title} — ${windows.length} windows`);
    }
    console.info('\n--dry-run: nothing sent, nothing written.');
    return;
  }

  const client = new Anthropic();
  const promptsFor = new Map<string, CriterionPrompt[]>();

  for (const { conversation, windows } of plan) {
    const setKey = `${conversation.engagement_type}/v${conversation.criteria_version}`;
    let criteria = promptsFor.get(setKey);
    if (!criteria) {
      const rows = await fetchCriteria(db, conversation.engagement_type, conversation.criteria_version);
      criteria = rows.map((row) => ({ key: row.key, label: row.label, definition: row.definition }));
      promptsFor.set(setKey, criteria);
    }

    const pending = new Map<string, PendingEvent>();
    let rejected = 0;

    for (const window of windows) {
      const result = await detectCriteria(window, {
        client,
        criteria,
        onUsage: databaseSink({
          db,
          detector: T1_DETECTOR,
          companyId: conversation.company_id,
          conversationId: conversation.id,
        }),
      });
      rejected += result.rejected.length;

      for (const event of result.events) {
        const segment = window.find((candidate) => candidate.id === event.span.segmentId);
        // The detector already checked the quote is in the window verbatim;
        // this resolves where, because the row stores offsets and the database
        // re-checks them against the segment on insert.
        const span = segment ? locate(segment.text, event.span.quote) : null;
        if (!segment || !span) {
          rejected += 1;
          continue;
        }

        // Deduplicated here as well as by the unique constraint: overlapping
        // windows re-observe the same span two or three times, and sending
        // each one to be rejected by the database would make the write a
        // conflict storm rather than an insert.
        const key = `${event.criterionKey}|${event.kind}|${segment.id}|${span.start}|${span.end}`;
        const existing = pending.get(key);
        if (existing && existing.confidence >= event.confidence) continue;

        pending.set(key, {
          company_id: conversation.company_id,
          conversation_id: conversation.id,
          criterion_key: event.criterionKey,
          kind: event.kind,
          confidence: event.confidence,
          segment_id: segment.id,
          quote: segment.text.slice(span.start, span.end),
          quote_start: span.start,
          quote_end: span.end,
          detector: result.detector,
          model: result.model,
        });
      }
    }

    const rows = [...pending.values()];
    if (rows.length > 0) {
      // Ignoring duplicates rather than failing: --rescore over a conversation
      // that already has events should add what is new, not refuse the batch
      // because the detector agreed with itself.
      const { error } = await db
        .from('criterion_events')
        .upsert(rows, {
          onConflict: 'conversation_id,criterion_key,kind,segment_id,quote_start,quote_end',
          ignoreDuplicates: true,
        });
      if (error) throw new Error(`Writing events for ${conversation.id} failed: ${error.message}`);
    }

    console.info(
      `${conversation.title}: ${rows.length} event(s) across ${windows.length} windows` +
        (rejected > 0 ? `, ${rejected} unquotable claim(s) dropped` : ''),
    );
  }

  console.info('\nScores are computed on read — nothing above stored a number.');
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
