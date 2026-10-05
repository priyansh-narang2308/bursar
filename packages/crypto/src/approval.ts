import {
  type ApprovalId,
  type CartHash,
  type DecisionId,
  type PolicyHash,
  timestampSchema,
  type UserId,
} from '@bursar/schemas';
import { constantTimeEqual, toBase64Url, utf8 } from './bytes';
import { CryptoError } from './errors';
import { domainMac } from './mac';

/**
 * Everything a signature binds. `approvalId` is the nonce: it is unique to one approval, so a
 * signature cannot be replayed onto another approval, even for the same cart and policy.
 */
export interface ApprovalClaims {
  readonly approvalId: ApprovalId;
  readonly decisionId: DecisionId;
  readonly approverId: UserId;
  readonly cartHash: CartHash;
  readonly policyHash: PolicyHash;
  /** RFC 3339 with a trailing Z. The approval is valid before this instant, not at or after it. */
  readonly expiresAt: string;
}

export type ApprovalCheck =
  | { readonly valid: true }
  | { readonly valid: false; readonly reason: 'bad-signature' | 'expired' };

function signatureOf(key: Uint8Array, claims: ApprovalClaims): string {
  return toBase64Url(
    domainMac(key, 'approval', {
      approvalId: claims.approvalId,
      decisionId: claims.decisionId,
      approverId: claims.approverId,
      cartHash: claims.cartHash,
      policyHash: claims.policyHash,
      expiresAt: claims.expiresAt,
    }),
  );
}

/**
 * A person's yes, signed by the server: an HMAC over the approval, the decision, the approver,
 * the cart hash, the policy hash and the expiry. Someone who can write to the database can set a
 * row to APPROVED but cannot make this, because the key never lives there.
 */
export function signApproval(key: Uint8Array, claims: ApprovalClaims): string {
  if (!timestampSchema.safeParse(claims.expiresAt).success) {
    throw new CryptoError('invalid-input', 'An approval expires at an RFC 3339 UTC timestamp.');
  }
  return signatureOf(key, claims);
}

/**
 * Whether `signature` is the server's signature over exactly these claims, and the approval has
 * not expired. The claims must come from what the server holds now: the cart hash recomputed
 * from the stored cart, the policy hash of the policy in force. If any of them differs from what
 * was signed, the signature fails, so a changed cart or policy voids the approval.
 */
export function verifyApproval(
  key: Uint8Array,
  claims: ApprovalClaims,
  signature: string,
  now: Date,
): ApprovalCheck {
  if (!constantTimeEqual(utf8(signatureOf(key, claims)), utf8(signature))) {
    return { valid: false, reason: 'bad-signature' };
  }
  // A time that does not parse is NaN, and no comparison with NaN is true: it counts as expired.
  return Date.parse(claims.expiresAt) > now.getTime()
    ? { valid: true }
    : { valid: false, reason: 'expired' };
}
