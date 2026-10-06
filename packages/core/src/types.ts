import type { Keyring } from '@bursar/crypto';
import type { Db } from '@bursar/db';
import type { PayPalClient } from '@bursar/paypal';
import type { Policy } from '@bursar/policy';
import { ERROR_CATALOG, type ErrorCode, type OrganizationId } from '@bursar/schemas';
import type { CircuitBreaker } from './breaker';

/** Who is doing it. Agents propose; people decide; the system and the Verifier act on their own. */
export interface Actor {
  readonly kind: 'USER' | 'AGENT' | 'SYSTEM' | 'VERIFIER';
  readonly id: string | null;
}

export interface CoreDeps {
  readonly db: Db;
  readonly paypal: PayPalClient;
  /** Seals PayPal Vault token ids at rest. */
  readonly vaultKeys: Keyring;
  readonly approvalKey: Uint8Array;
  /** The current provenance key first, then any retired key whose tags are still in circulation. */
  readonly provenanceKeys: readonly Uint8Array[];
  /** The id PayPal gave the registered webhook, for verification. */
  readonly webhookId: string;
  readonly now: () => Date;
  /** Revoking a mandate does not delete its PayPal token. For tokens that several workspaces share. */
  readonly keepVaultTokens?: boolean | undefined;
  readonly breaker: CircuitBreaker;
  /** The policy an organisation runs under. */
  readonly policyFor: (orgId: OrganizationId) => Policy;
}

/** A failure the caller can act on, in the vocabulary of the error catalog. */
export class CoreError extends Error {
  readonly code: ErrorCode;
  readonly detail: string;

  constructor(code: ErrorCode, detail: string) {
    super(ERROR_CATALOG[code].title);
    this.name = 'CoreError';
    this.code = code;
    this.detail = detail;
  }
}
