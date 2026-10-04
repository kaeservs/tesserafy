/**
 * An owner's full copy of their company's data, as one JSON file.
 *
 * Pure: the route reads the rows, through the owner's own session and under
 * RLS, and this only arranges them — every call with its transcript, the
 * evidence behind its score, and the signals read from it; then the insights,
 * the team and the erasure log. Arranging is where a mistake would quietly
 * attach a quote to the wrong call, so it is the part with tests.
 *
 * Scores are included, but as what they are: computed on export from the
 * evidence by the scoring rules, exactly as every page computes them. Nothing
 * stored is a score (invariant 1), and the file says so, so nobody reads a
 * number in it as a record of what the product once showed.
 */

export const EXPORT_FORMAT = 'tesserafy-export';
export const EXPORT_VERSION = 2;

/**
 * Everything else a company made, beyond its calls: each table with the
 * columns that are the company's own, read under RLS as the owner exporting.
 * Listed, not `*`: a column added later is a decision to export, and a
 * column that is ours rather than theirs (a tracker's sealed token, a
 * detector's version) is never sent. Version 2 added this section.
 */
export const WORK_TABLES = [
  { key: 'customers', table: 'accounts', columns: 'id, name, domain, created_by, created_at' },
  { key: 'action_items', table: 'action_items', columns: 'id, conversation_id, segment_id, quote, action, owner_side, owner_name, due, done, done_by, done_at, created_at' },
  { key: 'follow_ups', table: 'follow_ups', columns: 'id, conversation_id, subject, greeting, opening, closing, drafted_by, created_at' },
  { key: 'follow_up_lines', table: 'follow_up_lines', columns: 'id, follow_up_id, position, kind, text, segment_id, quote' },
  { key: 'call_preps', table: 'call_preps', columns: 'id, account_id, person_name, person_title, linkedin_url, call_at, engagement_type, profile_text, research, research_at, brief, brief_at, created_by, created_at' },
  { key: 'coaching', table: 'coaching_assignments', columns: 'id, conversation_id, segment_id, assigned_by, assigned_to, note, reply, status, created_at, done_at' },
  { key: 'examples', table: 'moments', columns: 'id, conversation_id, segment_id, criterion_key, engagement_type, note, saved_by, created_at' },
  { key: 'ai_guidance', table: 'ai_guidance', columns: 'id, feature, kind, engagement_type, criterion_key, body, quote, result, conversation_id, prep_id, active, created_by, created_at' },
  { key: 'scorecards', table: 'criteria_definitions', columns: 'id, engagement_type, version, key, label, definition, weight, position, candidate_threshold, confirm_threshold, corroborating_segments, published_by, created_at', ownOnly: true },
  { key: 'scorecard_purposes', table: 'scorecard_purposes', columns: 'engagement_type, purpose, set_by, updated_at', order: 'engagement_type' },
  { key: 'criterion_goals', table: 'criterion_goals', columns: 'engagement_type, criterion_key, target, set_by, updated_at', order: 'criterion_key' },
  { key: 'our_speakers', table: 'our_speakers', columns: 'name, added_by, created_at', order: 'name' },
  { key: 'knowledge_documents', table: 'knowledge_documents', columns: 'id, title, source, file_name, characters, passages, status, created_by, created_at' },
  { key: 'insight_comments', table: 'insight_comments', columns: 'id, insight_id, author, body, created_at' },
  { key: 'insight_events', table: 'insight_events', columns: 'id, insight_id, kind, detail, actor, at' },
  { key: 'insight_tickets', table: 'insight_tickets', columns: 'id, insight_id, provider, external_id, url, created_by, created_at' },
  { key: 'tracker', table: 'company_trackers', columns: 'provider, target, connected_by, connected_at', order: 'provider' },
  { key: 'crm', table: 'company_crms', columns: 'provider, account_ref, connected_by, connected_at', order: 'provider' },
  { key: 'crm_notes', table: 'crm_logs', columns: 'id, conversation_id, provider, external_id, crm_company_id, crm_company_name, logged_by, logged_at' },
] as const;

/** Columns that hold a person: exported as their address, as everywhere in the file. */
const PERSON_COLUMNS = new Set([
  'created_by', 'done_by', 'drafted_by', 'assigned_by', 'assigned_to', 'saved_by',
  'published_by', 'set_by', 'added_by', 'author', 'actor', 'connected_by', 'logged_by',
]);

export type WorkRow = Record<string, unknown>;

export interface ConversationRow {
  id: string;
  company_id: string;
  title: string;
  occurred_at: string | null;
  created_at: string;
  engagement_type: string;
  criteria_version: number;
  consent_statement: string | null;
  consent_confirmed_at: string | null;
  outcome: string | null;
  account_id?: string | null;
}

export interface NoteRow {
  conversation_id: string;
  segment_id: string;
  author: string | null;
  body: string;
  created_at: string;
  updated_at: string;
}

export interface EditRow {
  conversation_id: string;
  field: string;
  old_value: string | null;
  new_value: string | null;
  evidence_removed: number;
  actor: string | null;
  at: string;
}

export interface SegmentRow {
  id: string;
  conversation_id: string;
  speaker: string | null;
  start_ms: number;
  end_ms: number;
  text: string;
}

export interface CriterionEventRow {
  conversation_id: string;
  criterion_key: string;
  kind: string;
  confidence: number;
  segment_id: string;
  quote: string;
  detector: string;
  model: string;
  created_at: string;
}

export interface SignalRow {
  id: string;
  conversation_id: string;
  kind: string;
  summary: string;
  confidence: number;
}

export interface SignalEvidenceRow {
  signal_id: string;
  segment_id: string;
  quote: string;
}

export interface InsightRow {
  id: string;
  title: string;
  summary: string;
  status: string;
  created_at: string;
  decided_at: string | null;
}

export interface InsightEvidenceRow {
  insight_id: string;
  signal_id: string;
}

export interface TeamRow {
  email: string;
  role: string;
  joined_at: string;
}

export interface ErasureRow {
  conversation_id: string;
  reason: string;
  created_at: string;
  segments_removed: number;
  signals_removed: number;
}

export interface ComputedScore {
  score: number;
  criteria: { key: string; label: string; status: string }[];
}

export interface ExportParts {
  exportId: string;
  exportedAt: string;
  exportedBy: string;
  companyName: string;
  team: TeamRow[];
  conversations: ConversationRow[];
  segments: SegmentRow[];
  criterionEvents: CriterionEventRow[];
  signals: SignalRow[];
  signalEvidence: SignalEvidenceRow[];
  insights: InsightRow[];
  insightEvidence: InsightEvidenceRow[];
  erasures: ErasureRow[];
  notes: NoteRow[];
  edits: EditRow[];
  /** User id to address, for naming who wrote a note or made a change. */
  people: ReadonlyMap<string, string>;
  /** Account id to the customer's name. */
  accounts?: ReadonlyMap<string, string>;
  /** WORK_TABLES, by key. */
  work?: Readonly<Record<string, readonly WorkRow[]>>;
  scores: ReadonlyMap<string, ComputedScore>;
}

function group<T, K>(rows: readonly T[], key: (row: T) => K): Map<K, T[]> {
  const out = new Map<K, T[]>();
  for (const row of rows) {
    const k = key(row);
    const bucket = out.get(k);
    if (bucket) bucket.push(row);
    else out.set(k, [row]);
  }
  return out;
}

export function assembleExport(parts: ExportParts) {
  const segmentsBy = group(parts.segments, (row) => row.conversation_id);
  const eventsBy = group(parts.criterionEvents, (row) => row.conversation_id);
  const signalsBy = group(parts.signals, (row) => row.conversation_id);
  const evidenceBy = group(parts.signalEvidence, (row) => row.signal_id);
  const citedBy = group(parts.insightEvidence, (row) => row.insight_id);
  const notesBy = group(parts.notes, (row) => row.conversation_id);
  const editsBy = group(parts.edits, (row) => row.conversation_id);
  const who = (id: string | null) => (id ? (parts.people.get(id) ?? 'a former member') : 'a former member');

  return {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    export_id: parts.exportId,
    exported_at: parts.exportedAt,
    exported_by: parts.exportedBy,
    company: { name: parts.companyName },
    about: [
      'Everything Tesserafy holds for this company, as the owner who exported it could read it.',
      'Transcripts are as stored: email addresses, phone numbers and account-length numbers were masked before they were saved, so they appear as [email], [phone] and [number].',
      'Scores are not stored anywhere. Each one here was computed at export time from criterion_evidence by the scoring rules for the call\'s criteria version, as the product computes them on every page.',
      'Every signal and every insight cites quotes that appear word for word in the transcript segment they name.',
      'erasures lists calls that were deleted: when and why, never what they contained.',
      'work holds everything else the company made: customers, action items, follow-up emails, call preps, coaching, saved examples, AI guidance, its own scorecards and goals, knowledge documents (their details; the files are the ones you uploaded), and the work on insights. People are named by address; someone no longer in the company appears as "a former member".',
    ],
    team: parts.team,
    conversations: parts.conversations.map((conversation) => {
      const score = parts.scores.get(conversation.id);
      return {
        id: conversation.id,
        title: conversation.title,
        occurred_at: conversation.occurred_at,
        imported_at: conversation.created_at,
        engagement_type: conversation.engagement_type,
        criteria_version: conversation.criteria_version,
        outcome: conversation.outcome,
        customer: conversation.account_id ? (parts.accounts?.get(conversation.account_id) ?? null) : null,
        recording_consent:
          conversation.consent_statement && conversation.consent_confirmed_at
            ? { statement: conversation.consent_statement, confirmed_at: conversation.consent_confirmed_at }
            : null,
        score: score ? Math.round(score.score) : null,
        criteria: score?.criteria ?? [],
        transcript: (segmentsBy.get(conversation.id) ?? [])
          .slice()
          .sort((a, b) => a.start_ms - b.start_ms)
          .map((segment) => ({
            segment_id: segment.id,
            speaker: segment.speaker,
            start_ms: segment.start_ms,
            end_ms: segment.end_ms,
            text: segment.text,
          })),
        criterion_evidence: (eventsBy.get(conversation.id) ?? []).map((event) => ({
          criterion_key: event.criterion_key,
          kind: event.kind,
          confidence: event.confidence,
          segment_id: event.segment_id,
          quote: event.quote,
          detector: event.detector,
          model: event.model,
          recorded_at: event.created_at,
        })),
        notes: (notesBy.get(conversation.id) ?? []).map((note) => ({
          segment_id: note.segment_id,
          author: who(note.author),
          body: note.body,
          written_at: note.created_at,
          edited_at: note.updated_at === note.created_at ? null : note.updated_at,
        })),
        history: (editsBy.get(conversation.id) ?? []).map((edit) => ({
          field: edit.field,
          from: edit.old_value,
          to: edit.new_value,
          evidence_removed: edit.evidence_removed,
          by: who(edit.actor),
          at: edit.at,
        })),
        signals: (signalsBy.get(conversation.id) ?? []).map((signal) => ({
          id: signal.id,
          kind: signal.kind,
          summary: signal.summary,
          confidence: signal.confidence,
          evidence: (evidenceBy.get(signal.id) ?? []).map((evidence) => ({
            segment_id: evidence.segment_id,
            quote: evidence.quote,
          })),
        })),
      };
    }),
    insights: parts.insights.map((insight) => ({
      id: insight.id,
      title: insight.title,
      summary: insight.summary,
      status: insight.status,
      created_at: insight.created_at,
      decided_at: insight.decided_at,
      cited_signal_ids: (citedBy.get(insight.id) ?? []).map((row) => row.signal_id),
    })),
    work: Object.fromEntries(
      WORK_TABLES.map(({ key }) => [
        key,
        (parts.work?.[key] ?? []).map((row) =>
          Object.fromEntries(
            Object.entries(row).map(([column, value]) => [
              column,
              PERSON_COLUMNS.has(column) && typeof value === 'string' ? (parts.people.get(value) ?? 'a former member') : value,
            ]),
          ),
        ),
      ]),
    ),
    erasures: parts.erasures.map((erasure) => ({
      conversation_id: erasure.conversation_id,
      reason: erasure.reason,
      erased_at: erasure.created_at,
      segments_removed: erasure.segments_removed,
      signals_removed: erasure.signals_removed,
    })),
  };
}

/** A filename that says whose and when, without anything a filesystem refuses. */
export function exportFilename(companyName: string, at: Date): string {
  const slug =
    companyName
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'company';
  return `tesserafy-export-${slug}-${at.toISOString().slice(0, 10)}.json`;
}
