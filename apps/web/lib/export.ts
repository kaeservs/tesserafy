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
export const EXPORT_VERSION = 1;

export interface ConversationRow {
  id: string;
  title: string;
  occurred_at: string | null;
  created_at: string;
  engagement_type: string;
  criteria_version: number;
  consent_statement: string | null;
  consent_confirmed_at: string | null;
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
