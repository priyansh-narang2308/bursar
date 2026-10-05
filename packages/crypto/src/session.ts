import type { JsonObject } from '@bursar/schemas';
import { constantTimeEqual, fromBase64Url, toBase64Url, utf8 } from './bytes';
import { canonicalize } from './canonical';
import { domainMac } from './mac';

const macOf = (key: Uint8Array, payload: string) => toBase64Url(domainMac(key, 'session', payload));

/**
 * A signed, stateless token for a browser session: `<payload>.<mac>`, both unpadded base64url. The
 * payload is the claims as canonical JSON and is readable by anyone, so it must hold no secret. Expiry
 * is a claim the caller checks, because only the caller knows the clock.
 */
export function signSession(key: Uint8Array, claims: JsonObject): string {
  const payload = toBase64Url(utf8(canonicalize(claims)));
  return `${payload}.${macOf(key, payload)}`;
}

/** The claims of a token this key signed, or undefined for anything else. Constant-time. */
export function verifySession(key: Uint8Array, token: string): JsonObject | undefined {
  const [payload, mac, ...rest] = token.split('.');
  if (payload === undefined || mac === undefined || rest.length > 0) {
    return undefined;
  }
  if (!constantTimeEqual(utf8(macOf(key, payload)), utf8(mac))) {
    return undefined;
  }
  try {
    const claims: unknown = JSON.parse(new TextDecoder().decode(fromBase64Url(payload)));
    return typeof claims === 'object' && claims !== null && !Array.isArray(claims)
      ? (claims as JsonObject)
      : undefined;
  } catch {
    return undefined;
  }
}
