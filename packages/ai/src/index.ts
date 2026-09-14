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
