export {
  type AuditDraft,
  appendEvent,
  auditDraftSchema,
  CHAIN_FAILURES,
  type ChainFailure,
  type ChainHead,
  type ChainVerdict,
  chainHeadSchema,
  entryHash,
  genesisHash,
  genesisHead,
  headOf,
  MAX_AUDIT_PAYLOAD_BYTES,
  type VerifyOptions,
  verifyChain,
} from './chain';
export { AuditError, type AuditErrorCode } from './errors';
