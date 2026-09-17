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
