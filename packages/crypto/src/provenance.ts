import { type ActionId, type AmountJSON, idSchemas, type OrganizationId } from '@bursar/schemas';
import { constantTimeEqual, toHex, utf8 } from './bytes';
import { CryptoError } from './errors';
import { domainMac } from './mac';

const TAG_PREFIX = 'bursar:v1:';

/** 128 bits, the least RFC 2104 recommends for a truncated HMAC-SHA-256. */
const MAC_HEX_LENGTH = 32;

const TAG_PATTERN = new RegExp(`^${TAG_PREFIX}([^:]+):[0-9a-f]{${MAC_HEX_LENGTH}}$`);

/** What a provenance tag vouches for: this organisation's action, for exactly this amount. */
export interface ProvenanceClaims {
  readonly orgId: OrganizationId;
  readonly actionId: ActionId;
  readonly amount: AmountJSON;
}

/**
 * The tag Bursar puts in PayPal's `custom_id` when it moves money: `bursar:v1:<action id>:<mac>`.
 * The MAC covers the organisation, the action and the amount, so a tag copied from one
 * transaction onto another, or onto the same action with a different amount, does not verify.
 * Someone with PayPal access but without the key cannot make one.
 */
export function provenanceTag(key: Uint8Array, claims: ProvenanceClaims): string {
  const mac = domainMac(key, 'provenance', {
    orgId: claims.orgId,
    actionId: claims.actionId,
    amount: { currency: claims.amount.currency, minor: claims.amount.minor },
  });
  return `${TAG_PREFIX}${claims.actionId}:${toHex(mac).slice(0, MAC_HEX_LENGTH)}`;
}

/**
 * The action a tag says it belongs to, or undefined if the text is not shaped like a tag. This
 * proves nothing: it only says which action to load, so that its organisation and amount can be
 * passed to `verifyProvenanceTag`, which does the proving.
 */
export function actionIdFromTag(text: string): ActionId | undefined {
  const parsed = idSchemas.action.safeParse(TAG_PATTERN.exec(text)?.[1]);
  return parsed.success ? parsed.data : undefined;
}

/**
 * Whether `text` is exactly the tag for these claims under one of `keys`: the current key first,
 * then any retired key whose tags are still in circulation, because tags outlive the transactions
 * they sit on. The comparison takes the same time wherever the tags first differ.
 */
export function verifyProvenanceTag(
  keys: readonly Uint8Array[],
  text: string,
  claims: ProvenanceClaims,
): boolean {
  if (keys.length === 0) {
    throw new CryptoError('invalid-key', 'At least one key is needed to verify a tag.');
  }
  const given = utf8(text);
  return keys.some((key) => constantTimeEqual(utf8(provenanceTag(key, claims)), given));
}
