/**
 * The agent's sources (ask-calls.ts): one company's calls and documents, as
 * the person asking may read them.
 *
 * Built from a client signed in as that person, never a service-role one, so
 * row-level security governs every read here as it governs their pages. The
 * searches by meaning go through retrieve(), with the company first, which is
 * the only code allowed to run one (ADR 0004); the rest are ordinary reads
 * under RLS. Nothing the model writes reaches a query except as a value: it
 * chooses what to search for, never where.
 */
import type { SupabaseClient } from '@tesserafy/db';
import type { Embedder } from '../providers/embedder';
import type { CompanyId } from '../retrieval/company-id';
import { retrieve } from '../retrieval/retrieve';
import type { AskSources, CallLine } from './ask-calls';

/**
 * Lower than RELATED_SIMILARITY, which is tuned for two pieces of the same
 * kind (one complaint against another). A question and the line that answers
 * it are phrased differently; search_words covers what this misses.
 */
const QUESTION_SIMILARITY = 0.75;

interface Header {
  title: string;
  occurredAt: string | null;
}

/** Which calls the agent may search: all of the company's, or only these. */
export interface AskScope {
  /** At most 2000; none means none. */
  readonly conversationIds?: readonly string[];
}

export function companySources(db: SupabaseClient, companyId: CompanyId, embedder: Embedder, scope: AskScope = {}): AskSources {
  const headers = new Map<string, Header>();
  const only = scope.conversationIds ? [...scope.conversationIds] : null;

  async function header(conversationIds: readonly string[]): Promise<void> {
    const missing = [...new Set(conversationIds)].filter((id) => !headers.has(id));
    if (missing.length === 0) return;
    const { data, error } = await db.from('conversations').select('id, title, occurred_at, created_at').in('id', missing);
    if (error) throw new Error(`reading call titles failed: ${error.message}`, { cause: error });
    for (const row of data ?? []) {
      headers.set(row.id, { title: row.title, occurredAt: row.occurred_at ?? row.created_at });
    }
  }

  function line(row: { id: string; conversation_id: string; start_ms: number; speaker: string | null; text: string }): CallLine | null {
    const found = headers.get(row.conversation_id);
    // A line whose call could not be read is not shown: RLS said no.
    if (!found) return null;
    return {
      segmentId: row.id,
      conversationId: row.conversation_id,
      title: found.title,
      occurredAt: found.occurredAt,
      startMs: row.start_ms,
      speaker: row.speaker,
      text: row.text,
    };
  }

  const lines = (rows: Parameters<typeof line>[0][]) => rows.flatMap((row) => line(row) ?? []);

  return {
    async searchMeaning(query, limit) {
      if (!query.trim()) return [];
      const found = await retrieve(companyId, { text: query }, {
        db,
        embedder,
        limit,
        minSimilarity: QUESTION_SIMILARITY,
        ...(only ? { conversationIds: only } : {}),
      });
      await header(found.map((segment) => segment.conversationId));
      return lines(
        found.map((segment) => ({
          id: segment.segmentId,
          conversation_id: segment.conversationId,
          start_ms: segment.startMs,
          speaker: segment.speaker,
          text: segment.text,
        })),
      );
    },

    async searchWords(words, limit) {
      if (!words.trim() || only?.length === 0) return [];
      // SECURITY INVOKER: the caller's RLS decides which lines it considers.
      const { data, error } = await db.rpc('search_segments', {
        p_query: words,
        p_limit: limit,
        ...(only ? { p_conversation_ids: only } : {}),
      });
      if (error) throw new Error(`search_segments failed: ${error.message}`, { cause: error });
      const rows = data ?? [];
      await header(rows.map((row) => row.conversation_id));
      return lines(
        rows.map((row) => ({
          id: row.segment_id,
          conversation_id: row.conversation_id,
          start_ms: row.start_ms,
          speaker: row.speaker,
          text: row.segment_text,
        })),
      );
    },

    async readAround(segmentId, before, after) {
      const { data: target, error } = await db
        .from('segments')
        .select('conversation_id, start_ms')
        .eq('id', segmentId)
        .maybeSingle();
      if (error) throw new Error(`reading a line failed: ${error.message}`, { cause: error });
      if (!target) return [];
      const columns = 'id, conversation_id, start_ms, speaker, text';
      const [earlier, later] = await Promise.all([
        db.from('segments').select(columns).eq('conversation_id', target.conversation_id)
          .lt('start_ms', target.start_ms).order('start_ms', { ascending: false }).limit(before),
        db.from('segments').select(columns).eq('conversation_id', target.conversation_id)
          .gte('start_ms', target.start_ms).order('start_ms').limit(after + 1),
      ]);
      if (earlier.error || later.error) throw new Error('reading around a line failed', { cause: earlier.error ?? later.error });
      await header([target.conversation_id]);
      return lines([...(earlier.data ?? []).reverse(), ...(later.data ?? [])]);
    },

    async searchDocuments(query, limit) {
      if (!query.trim()) return [];
      const found = await retrieve(companyId, { text: query }, { db, embedder, corpus: 'knowledge', limit });
      return found.map((passage) => ({ title: passage.title, text: passage.text }));
    },
  };
}
