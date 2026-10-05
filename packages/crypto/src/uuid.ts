import { createHash } from 'node:crypto';
import type { IdempotencyKey } from '@bursar/schemas';
import { CryptoError } from './errors';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The namespace of every UUID Bursar derives, a random UUID chosen once for this purpose. */
export const BURSAR_NAMESPACE = 'd131fa55-6ad2-466f-8ea5-7a294a2ed117';

const STEP_PATTERN = /^[a-z][a-z0-9-]{0,31}$/;

/** A name-based UUID (RFC 9562, version 5): one namespace and name always give one UUID. */
export function uuidV5(namespace: string, name: string): string {
  if (!UUID_PATTERN.test(namespace)) {
    throw new CryptoError('invalid-input', 'A namespace is a lower-case UUID.');
  }
  const digest = createHash('sha1')
    .update(Buffer.from(namespace.replaceAll('-', ''), 'hex'))
    .update(name, 'utf8')
    .digest()
    .subarray(0, 16);
  const view = new DataView(digest.buffer, digest.byteOffset, digest.byteLength);
  view.setUint8(6, (view.getUint8(6) & 0x0f) | 0x50); // version 5
  view.setUint8(8, (view.getUint8(8) & 0x3f) | 0x80); // the RFC variant
  return digest.toString('hex').replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5');
}

/**
 * The `PayPal-Request-Id` for one call made on behalf of an action. It depends only on the
 * action's idempotency key and the step, so retrying a call reuses its id and PayPal answers with
 * the original result, while two different calls for one action (create the order, then
 * authorise it) never share one. `step` is a short lower-case label such as `authorize`.
 */
export function payPalRequestId(key: IdempotencyKey, step: string): string {
  if (!STEP_PATTERN.test(step)) {
    throw new CryptoError('invalid-input', 'A step is a short lower-case label such as capture.');
  }
  return uuidV5(BURSAR_NAMESPACE, `${key}:${step}`);
}
