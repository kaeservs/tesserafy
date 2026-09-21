export { toCompanyId, isCompanyId, type CompanyId } from './retrieval/company-id';
export {
  retrieve,
  TenantBoundaryViolation,
  type RetrievalQuery,
  type RetrieveOptions,
  type RetrievedSegment,
} from './retrieval/retrieve';
export {
  createOllamaEmbedder,
  EMBEDDING_DIMENSIONS,
  type Embedder,
  type OllamaEmbedderOptions,
} from './providers/embedder';
export {
  conversationForSource,
  DuplicateSource,
  storeTranscript,
  type EmbeddedSegment,
  type StoreOptions,
  type StoreTranscriptInput,
} from './retrieval/store';
export {
  writeTranscript,
  type TranscriptInput,
  type WriteTranscriptOptions,
  type WrittenTranscript,
} from './ingest/write-transcript';
export {
  extractSignals,
  renderTranscript,
  T3_DETECTOR,
  T3_MODEL,
  type ExtractableSegment,
  type ExtractionResult,
  type ExtractOptions,
} from './tiers/t3-extract';
export {
  resolveSignals,
  type ClaimedSignal,
  type QuotableSegment,
  type RejectedSignal,
  type RejectionReason,
  type ResolvedEvidence,
  type ResolvedSignal,
} from './tiers/evidence';
export {
  logUsage,
  toUsageEvent,
  type UsageEvent,
  type UsageLike,
  type UsageSink,
} from './telemetry/usage';
export {
  writeSignals,
  type WriteSignalsInput,
  type WriteSignalsOptions,
} from './ingest/write-signals';
export {
  detectCriteria,
  renderWindow,
  systemPrompt,
  T1_DETECTOR,
  T1_MODEL,
  type CriterionPrompt,
  type DetectableSegment,
  type DetectionResult,
  type DetectOptions,
} from './tiers/t1-detect';
export { locate } from './tiers/evidence';
export {
  clusterSignals,
  loadSignals,
  type ClusterableSignal,
  type ClusterOptions,
  type SignalCluster,
} from './insights/cluster';
export {
  renderCluster,
  synthesiseInsight,
  T3_SYNTHESISER,
  T3_SYNTHESIS_MODEL,
  type RejectedCluster,
  type SynthesisedInsight,
  type SynthesiseOptions,
} from './insights/synthesise';
export { writeInsight, type WriteInsightOptions } from './insights/write-insight';
export { both, databaseSink, type UsageContext } from './telemetry/sink';
export {
  suggestNext,
  T2_MODEL,
  T2_SUGGESTER,
  type NoSuggestion,
  type SuggestableSegment,
  type Suggestion,
  type SuggestOptions,
} from './tiers/t2-suggest';
