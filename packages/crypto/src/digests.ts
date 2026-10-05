import {
  type ActionId,
  type ActionType,
  type AmountJSON,
  type Cart,
  type CartHash,
  type CartLine,
  cartHashSchema,
  type IdempotencyKey,
  type InputsHash,
  idempotencyKeySchema,
  inputsHashSchema,
  type JsonValue,
  type MandateId,
  type MissionId,
  type OrganizationId,
  type PolicyHash,
  policyHashSchema,
  type SupplierId,
} from '@bursar/schemas';
import { canonicalize } from './canonical';
import { CryptoError } from './errors';
import { domainHash } from './hash';

/** The parts of a cart an approval covers: what the approver saw, nothing that changes later. */
export type CartContent = Pick<Cart, 'id' | 'orgId' | 'missionId' | 'version' | 'lines' | 'total'>;

/** An amount as its two wire fields only, so a stray extra property can never change a digest. */
function amountOf({ currency, minor }: AmountJSON) {
  return { currency, minor };
}

function lineOf(line: CartLine) {
  return {
    id: line.id,
    offerId: line.offerId,
    quantity: line.quantity,
    unitPrice: amountOf(line.unitPrice),
    lineTotal: amountOf(line.lineTotal),
    rationale: line.rationale,
  };
}

function compareText(a: string, b: string): number {
  if (a < b) {
    return -1;
  }
  return a > b ? 1 : 0;
}

/**
 * The lines in a fixed order, so that loading them from a database in a different order cannot
 * make an honest cart look altered. They sort by their canonical form, which starts with the line
 * id, so the order is total even for lines that tie on everything.
 */
function sortedLines(lines: readonly CartLine[]) {
  return lines
    .map(lineOf)
    .map((line) => ({ line, text: canonicalize(line) }))
    .sort((a, b) => compareText(a.text, b.text))
    .map(({ line }) => line);
}

/**
 * The digest an approval signs. It covers the cart's identity, its version, every line with its
 * quantity, prices and rationale, and the total, so changing any of them gives a different hash
 * and voids the approval. The status, the creation time and the hash itself are not covered:
 * they change as the cart moves through its life, and the hash cannot contain itself.
 *
 * Lines are order-independent. The inputs are server records, never values from a client or an
 * LLM: the hash says what the server holds, not what anyone claims.
 */
export function cartHash(cart: CartContent): CartHash {
  return cartHashSchema.parse(
    domainHash('cart', {
      id: cart.id,
      orgId: cart.orgId,
      missionId: cart.missionId,
      version: cart.version,
      lines: sortedLines(cart.lines),
      total: amountOf(cart.total),
    }),
  );
}

/** Whether a stored cart's hash is what its content hashes to now. */
export function verifyCartHash(cart: Cart): boolean {
  return cartHash(cart) === cart.cartHash;
}

/** The digest of a policy version's content, so a decision names exactly the rules that made it. */
export function policyHash(policy: JsonValue): PolicyHash {
  return policyHashSchema.parse(domainHash('policy', policy));
}

/** The digest of what a decision was evaluated on, so the decision can be replayed and compared. */
export function inputsHash(inputs: JsonValue): InputsHash {
  return inputsHashSchema.parse(domainHash('inputs', inputs));
}

/**
 * Which action this is, as opposed to how much it moves. A retry names the same action and so
 * gets the same key; it can never become a second action by changing a parameter, because no
 * parameter such as an amount is part of the identity.
 */
export interface ActionIdentity {
  readonly orgId: OrganizationId;
  readonly type: ActionType;
  readonly missionId: MissionId | null;
  readonly mandateId: MandateId | null;
  readonly supplierId: SupplierId | null;
  readonly cartHash: CartHash | null;
  /** The action a VOID or REFUND undoes. */
  readonly compensatesActionId: ActionId | null;
  /** 1 for the first action of this kind on this subject, 2 for the next (a second capture). */
  readonly ordinal: number;
}

/**
 * The idempotency key of an action. The database holds it unique, so a repeated request finds the
 * action it already made instead of making another.
 */
export function idempotencyKey(identity: ActionIdentity): IdempotencyKey {
  if (!Number.isSafeInteger(identity.ordinal) || identity.ordinal < 1) {
    throw new CryptoError('invalid-input', 'An ordinal is a whole number, starting at 1.');
  }
  return idempotencyKeySchema.parse(
    domainHash('idempotency', {
      orgId: identity.orgId,
      type: identity.type,
      missionId: identity.missionId,
      mandateId: identity.mandateId,
      supplierId: identity.supplierId,
      cartHash: identity.cartHash,
      compensatesActionId: identity.compensatesActionId,
      ordinal: identity.ordinal,
    }),
  );
}
