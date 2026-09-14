/**
 * The criterion state machine. ADR 0003.
 *
 *   unobserved -> candidate -> confirmed
 *        \            \           |
 *         \            \          v
 *          `----------> `---> contradicted ---> confirmed (fresh evidence only)
 *
 * Confirmed is latching: evidence can never demote it, and a missing event is
 * not an event. Only a contradiction at or above the confirm threshold moves
 * it, and that is recorded as a Transition.
 *
 * Pure: the same events in the same order always yield the same state.
 */
import type {
  CriteriaSet,
  CriterionDefinition,
  CriterionState,
  CriterionStatus,
  DetectorEvent,
  EvidenceSpan,
  RecordedSpan,
  ScorecardState,
  Transition,
} from '../types';

export function initialState(criteriaSet: CriteriaSet): ScorecardState {
  const criteria: Record<string, CriterionState> = {};
  for (const c of criteriaSet.criteria) {
    criteria[c.key] = { key: c.key, status: 'unobserved', evidence: [], contradictions: [] };
  }
  return { criteriaSet, seq: 0, criteria, transitions: [] };
}

/**
 * Applies one detector event. Returns the same object when the event changes
 * nothing, so a UI can skip the repaint by reference equality.
 */
export function apply(state: ScorecardState, event: DetectorEvent): ScorecardState {
  const definition = state.criteriaSet.criteria.find((c) => c.key === event.criterionKey);
  if (!definition) {
    throw new Error(
      `Unknown criterion "${event.criterionKey}" for ${state.criteriaSet.engagementType} v${state.criteriaSet.version}`,
    );
  }
  assertConfidence(event.confidence);
  assertSpan(event.span);

  const current = state.criteria[definition.key]!;
  return event.kind === 'evidence'
    ? applyEvidence(state, definition, current, event.confidence, event.span)
    : applyContradiction(state, definition, current, event.confidence, event.span);
}

/** Folds a whole event sequence. Post-call scoring is exactly this. */
export function replay(criteriaSet: CriteriaSet, events: readonly DetectorEvent[]): ScorecardState {
  return events.reduce(apply, initialState(criteriaSet));
}

function applyEvidence(
  state: ScorecardState,
  definition: CriterionDefinition,
  current: CriterionState,
  confidence: number,
  span: EvidenceSpan,
): ScorecardState {
  const { thresholds } = definition;
  if (confidence < thresholds.candidate) {
    return state; // below the noise floor: not evidence
  }

  // A detector retry can report the same span twice. It is one piece of
  // evidence; keep the higher confidence, and its original position.
  const duplicate = current.evidence.find((r) => sameSpan(r.span, span));
  if (duplicate && duplicate.confidence >= confidence) {
    return state;
  }

  const seq = duplicate ? state.seq : state.seq + 1;
  const recorded: RecordedSpan = { seq: duplicate?.seq ?? seq, confidence, span };
  const evidence = duplicate
    ? current.evidence.map((r) => (r === duplicate ? recorded : r))
    : [...current.evidence, recorded];

  let to: CriterionStatus = current.status;
  let because: readonly RecordedSpan[] = [recorded];

  switch (current.status) {
    case 'confirmed':
      break; // latching
    case 'unobserved':
    case 'candidate': {
      const confirming = confirmingSpans(evidence, definition);
      if (confirming) {
        to = 'confirmed';
        because = confirming;
      } else {
        to = 'candidate';
      }
      break;
    }
    case 'contradicted': {
      // Only evidence newer than the latest contradiction can overturn it.
      const lastContradiction = Math.max(...current.contradictions.map((r) => r.seq));
      const confirming = confirmingSpans(
        evidence.filter((r) => r.seq > lastContradiction),
        definition,
      );
      if (confirming) {
        to = 'confirmed';
        because = confirming;
      }
      break;
    }
  }

  return commit(state, seq, { ...current, status: to, evidence }, current.status, 'evidence', because);
}

function applyContradiction(
  state: ScorecardState,
  definition: CriterionDefinition,
  current: CriterionState,
  confidence: number,
  span: EvidenceSpan,
): ScorecardState {
  // Demotion is what makes a score move backwards, so it needs the same
  // certainty that confirmation does.
  if (confidence < definition.thresholds.confirm) {
    return state;
  }
  if (current.contradictions.some((r) => sameSpan(r.span, span))) {
    return state;
  }

  const seq = state.seq + 1;
  const recorded: RecordedSpan = { seq, confidence, span };
  const contradictions = [...current.contradictions, recorded];

  // Nothing observed means nothing to contradict: keep the span for the
  // explanation, change no status.
  const to: CriterionStatus = current.status === 'unobserved' ? 'unobserved' : 'contradicted';

  return commit(
    state,
    seq,
    { ...current, status: to, contradictions },
    current.status,
    'contradiction',
    [recorded],
  );
}

function commit(
  state: ScorecardState,
  seq: number,
  next: CriterionState,
  from: CriterionStatus,
  cause: Transition['cause'],
  spans: readonly RecordedSpan[],
): ScorecardState {
  const transitions =
    next.status === from
      ? state.transitions
      : [...state.transitions, { seq, criterionKey: next.key, from, to: next.status, cause, spans }];

  return {
    ...state,
    seq,
    criteria: { ...state.criteria, [next.key]: next },
    transitions,
  };
}

/**
 * The spans that satisfy the confirm rule, or null.
 *
 * Either one span at or above `confirm`, or the strongest span from each of
 * `corroboratingSegments` distinct segments. Two quotes from the same segment
 * are one observation, not two.
 */
function confirmingSpans(
  evidence: readonly RecordedSpan[],
  { thresholds }: CriterionDefinition,
): readonly RecordedSpan[] | null {
  const strong = evidence.find((r) => r.confidence >= thresholds.confirm);
  if (strong) return [strong];

  const bestPerSegment = new Map<string, RecordedSpan>();
  for (const r of evidence) {
    const best = bestPerSegment.get(r.span.segmentId);
    if (!best || r.confidence > best.confidence) bestPerSegment.set(r.span.segmentId, r);
  }
  if (bestPerSegment.size >= thresholds.corroboratingSegments) {
    return [...bestPerSegment.values()]
      .sort((a, b) => a.seq - b.seq)
      .slice(0, thresholds.corroboratingSegments);
  }
  return null;
}

function sameSpan(a: EvidenceSpan, b: EvidenceSpan): boolean {
  return a.segmentId === b.segmentId && a.startMs === b.startMs && a.endMs === b.endMs;
}

function assertConfidence(confidence: number): void {
  if (!(Number.isFinite(confidence) && confidence >= 0 && confidence <= 1)) {
    throw new RangeError(`confidence must be between 0 and 1, got ${confidence}`);
  }
}

function assertSpan(span: EvidenceSpan): void {
  if (span.segmentId.length === 0) {
    throw new Error('Evidence span needs a segmentId');
  }
  if (!(Number.isInteger(span.startMs) && span.startMs >= 0 && Number.isInteger(span.endMs) && span.endMs >= span.startMs)) {
    throw new RangeError(`Evidence span has invalid timing ${span.startMs}–${span.endMs}`);
  }
  if (span.quote.trim().length === 0) {
    throw new Error('Evidence span needs a quote (invariant 4)');
  }
}
