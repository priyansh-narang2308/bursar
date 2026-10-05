import { type AmountJSON, type ApprovalId, idSchemas } from '@bursar/schemas';
import { describe, expect, it } from 'vitest';
import { toHex } from '../src/bytes';
import {
  actionIdFromTag,
  type ProvenanceClaims,
  provenanceTag,
  verifyProvenanceTag,
} from '../src/provenance';
import { BASE64URL_ALPHABET, HEX_ALPHABET, ids, otherChar, testKey, usd } from './support';
import { VECTORS } from './vectors';

const tagKey = testKey(0x40);

const claims: ProvenanceClaims = { orgId: ids.org, actionId: ids.action, amount: usd('3499') };

describe('provenanceTag', () => {
  it('matches the independently computed value', () => {
    expect(provenanceTag(tagKey, claims)).toBe(VECTORS.provenanceTag);
  });

  it('is short enough for PayPal’s custom_id, which allows 255 characters', () => {
    expect(provenanceTag(tagKey, claims)).toHaveLength(73);
  });

  it('is the same for the same claims and different for any claim', () => {
    const tags = [
      claims,
      { ...claims, orgId: ids.org2 },
      { ...claims, actionId: ids.action2 },
      { ...claims, amount: usd('3500') },
      { ...claims, amount: { currency: 'EUR', minor: '3499' } satisfies AmountJSON },
    ].map((variant) => provenanceTag(tagKey, variant));
    expect(new Set(tags).size).toBe(5);
    expect(tags[0]).toBe(provenanceTag(tagKey, { ...claims }));
  });

  it('ignores properties outside the claims', () => {
    const noisy = { ...claims, amount: { ...claims.amount, extra: 1 }, extra: 1 };
    expect(provenanceTag(tagKey, noisy)).toBe(VECTORS.provenanceTag);
  });

  it('depends on the key', () => {
    expect(provenanceTag(testKey(0x41), claims)).not.toBe(VECTORS.provenanceTag);
  });
});

describe('verifyProvenanceTag', () => {
  it('accepts the tag made for these claims', () => {
    expect(verifyProvenanceTag([tagKey], VECTORS.provenanceTag, claims)).toBe(true);
  });

  it('rejects the tag for any other organisation, action or amount', () => {
    for (const other of [
      { ...claims, orgId: ids.org2 },
      { ...claims, actionId: ids.action2 },
      { ...claims, amount: usd('3498') },
      { ...claims, amount: { currency: 'EUR', minor: '3499' } satisfies AmountJSON },
    ]) {
      expect(verifyProvenanceTag([tagKey], VECTORS.provenanceTag, other)).toBe(false);
    }
  });

  it('rejects a tag made with another key', () => {
    expect(verifyProvenanceTag([testKey(0x41)], VECTORS.provenanceTag, claims)).toBe(false);
  });

  it('rejects the tag with any single character changed', () => {
    for (let index = 0; index < VECTORS.provenanceTag.length; index++) {
      const altered = `${VECTORS.provenanceTag.slice(0, index)}${otherChar(VECTORS.provenanceTag.charAt(index), `${BASE64URL_ALPHABET}:`)}${VECTORS.provenanceTag.slice(index + 1)}`;
      expect(verifyProvenanceTag([tagKey], altered, claims)).toBe(false);
    }
  });

  it('rejects the message authentication code with any bit of it flipped', () => {
    const mac = VECTORS.provenanceTag.slice(-32);
    for (let byte = 0; byte < 16; byte++) {
      for (let bit = 0; bit < 8; bit++) {
        const bytes = Buffer.from(mac, 'hex');
        bytes[byte] = (bytes[byte] ?? 0) ^ (1 << bit);
        const altered = `${VECTORS.provenanceTag.slice(0, -32)}${toHex(bytes)}`;
        expect(verifyProvenanceTag([tagKey], altered, claims)).toBe(false);
      }
    }
  });

  it.each([
    ['empty text', ''],
    ['text from another system', 'invoice-1234'],
    [
      'upper-case hex',
      VECTORS.provenanceTag.toUpperCase().replace('BURSAR:V1:ACT_', 'bursar:v1:act_'),
    ],
    ['a missing code', VECTORS.provenanceTag.slice(0, -33)],
    ['a truncated code', VECTORS.provenanceTag.slice(0, -1)],
    ['a code with extra text', `${VECTORS.provenanceTag}0`],
    ['leading space', ` ${VECTORS.provenanceTag}`],
    ['trailing newline', `${VECTORS.provenanceTag}\n`],
    ['another version', VECTORS.provenanceTag.replace('v1', 'v2')],
    ['another prefix', VECTORS.provenanceTag.replace('bursar', 'Bursar')],
  ])('rejects %s', (_what, text) => {
    expect(verifyProvenanceTag([tagKey], text, claims)).toBe(false);
  });

  it('accepts a tag made under a retired key if that key is still listed', () => {
    const retired = testKey(0x50);
    const old = provenanceTag(retired, claims);
    expect(verifyProvenanceTag([tagKey, retired], old, claims)).toBe(true);
    expect(verifyProvenanceTag([retired, tagKey], old, claims)).toBe(true);
    expect(verifyProvenanceTag([tagKey], old, claims)).toBe(false);
  });

  it('refuses to verify without a key, or with one of the wrong size', () => {
    expect(() => verifyProvenanceTag([], VECTORS.provenanceTag, claims)).toThrow(
      expect.objectContaining({ code: 'invalid-key' }),
    );
    expect(() => verifyProvenanceTag([tagKey, new Uint8Array(8)], 'x', claims)).toThrow(
      expect.objectContaining({ code: 'invalid-key' }),
    );
  });
});

describe('actionIdFromTag', () => {
  it('reads the action a tag claims to belong to', () => {
    expect(actionIdFromTag(VECTORS.provenanceTag)).toBe(ids.action);
  });

  it('proves nothing: a tag with a wrong code still names its action', () => {
    const forged = `bursar:v1:${ids.action}:${'0'.repeat(32)}`;
    expect(actionIdFromTag(forged)).toBe(ids.action);
    expect(verifyProvenanceTag([tagKey], forged, claims)).toBe(false);
  });

  it.each([
    ['empty text', ''],
    ['foreign text', 'order-77'],
    ['no code', `bursar:v1:${ids.action}`],
    ['a short code', `bursar:v1:${ids.action}:${'a'.repeat(31)}`],
    ['a long code', `bursar:v1:${ids.action}:${'a'.repeat(33)}`],
    ['an upper-case code', `bursar:v1:${ids.action}:${'A'.repeat(32)}`],
    ['another version', `bursar:v2:${ids.action}:${'a'.repeat(32)}`],
    ['an id of another kind', `bursar:v1:${ids.mission}:${'a'.repeat(32)}`],
    ['a malformed id', `bursar:v1:act_nope:${'a'.repeat(32)}`],
    ['text around the tag', ` ${VECTORS.provenanceTag} `],
    ['two tags', `${VECTORS.provenanceTag}${VECTORS.provenanceTag}`],
  ])('finds no action in %s', (_what, text) => {
    expect(actionIdFromTag(text)).toBeUndefined();
  });

  it('only ever returns a well-formed action id', () => {
    expect(idSchemas.action.safeParse(actionIdFromTag(VECTORS.provenanceTag)).success).toBe(true);
    const unrelated: ApprovalId = ids.approval;
    expect(actionIdFromTag(`bursar:v1:${unrelated}:${'a'.repeat(32)}`)).toBeUndefined();
    expect(HEX_ALPHABET).toHaveLength(16);
  });
});
