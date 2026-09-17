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
