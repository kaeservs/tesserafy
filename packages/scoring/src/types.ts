/**
 * Types for the scorecard engine. ADR 0003.
 *
 * Detectors (T1 live, T3 post-call) produce DetectorEvents. Nothing else in
 * this package talks to a model, a network or a clock.
 */

export type CriterionStatus = 'unobserved' | 'candidate' | 'confirmed' | 'contradicted';

/** A quoted, timestamped span of transcript — invariant 4. */
export interface EvidenceSpan {
  readonly segmentId: string;
  readonly startMs: number;
  readonly endMs: number;
  readonly quote: string;
}

export interface Thresholds {
  /** Minimum confidence for evidence to count at all. */
  readonly candidate: number;
  /** A single span at or above this confirms. Also the bar for a contradiction. */
  readonly confirm: number;
  /** Spans from this many distinct segments, each >= candidate, also confirm. */
  readonly corroboratingSegments: number;
}

export interface CriterionDefinition {
  readonly key: string;
  readonly label: string;
  readonly weight: number;
  readonly thresholds: Thresholds;
}

/** Seed data, versioned. A conversation pins the version it was scored against. */
export interface CriteriaSet {
  readonly engagementType: string;
  readonly version: number;
  readonly criteria: readonly CriterionDefinition[];
}

export type DetectorEvent =
  | {
      readonly kind: 'evidence';
      readonly criterionKey: string;
      readonly confidence: number;
      readonly span: EvidenceSpan;
    }
  | {
      /** Only an explicit negation detector emits this. Absence never does. */
      readonly kind: 'contradiction';
      readonly criterionKey: string;
      readonly confidence: number;
      readonly span: EvidenceSpan;
    };

/** A span the engine accepted, with the order in which it arrived. */
export interface RecordedSpan {
  readonly seq: number;
  readonly confidence: number;
  readonly span: EvidenceSpan;
}

export interface CriterionState {
  readonly key: string;
  readonly status: CriterionStatus;
  readonly evidence: readonly RecordedSpan[];
  readonly contradictions: readonly RecordedSpan[];
}

/** Every status change, with the spans that caused it. The audit trail. */
export interface Transition {
  readonly seq: number;
  readonly criterionKey: string;
  readonly from: CriterionStatus;
  readonly to: CriterionStatus;
  readonly cause: DetectorEvent['kind'];
  readonly spans: readonly RecordedSpan[];
}

export interface ScorecardState {
  readonly criteriaSet: CriteriaSet;
  /** Sequence number of the last recorded span. */
  readonly seq: number;
  readonly criteria: Readonly<Record<string, CriterionState>>;
  readonly transitions: readonly Transition[];
}
