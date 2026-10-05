import { approvalSchema, cartHashSchema, policyHashSchema } from '@bursar/schemas';
import { describe, expect, it } from 'vitest';
import { type ApprovalClaims, signApproval, verifyApproval } from '../src/approval';
import { BASE64URL_ALPHABET, ids, otherChar, testKey } from './support';
import { VECTORS } from './vectors';

const signingKey = testKey(0x80);

const claims: ApprovalClaims = {
  approvalId: ids.approval,
  decisionId: ids.decision,
  approverId: ids.user,
  cartHash: cartHashSchema.parse(
    '3001994879c426dd478b10b43aac598817821609da4153e296ce9f3eefbe72a8',
  ),
  policyHash: policyHashSchema.parse(
    '6d61a34788017934a1804dc22191e12089d60c530788e7ee52a6725e471a0bf7',
  ),
  expiresAt: '2026-10-05T13:00:00Z',
};

const before = new Date('2026-10-05T12:59:59.999Z');
const atExpiry = new Date('2026-10-05T13:00:00.000Z');

describe('signApproval', () => {
  it('matches the independently computed value', () => {
    expect(signApproval(signingKey, claims)).toBe(VECTORS.approvalSignature);
  });

  it('fits the signature field of an approval', () => {
    const approval = {
      id: ids.approval,
      decisionId: ids.decision,
      approverId: ids.user,
      status: 'APPROVED',
      cartHash: claims.cartHash,
      policyHash: claims.policyHash,
      signature: signApproval(signingKey, claims),
      expiresAt: claims.expiresAt,
      decidedAt: '2026-10-05T12:30:00Z',
    };
    expect(approvalSchema.safeParse(approval).success).toBe(true);
  });

  it('ignores properties outside the claims', () => {
    expect(signApproval(signingKey, { ...claims, extra: 1 } as ApprovalClaims)).toBe(
      VECTORS.approvalSignature,
    );
  });

  it.each([
    ['a date without a time', '2026-10-05'],
    ['words', 'tomorrow'],
    ['a time without a zone', '2026-10-05T13:00:00'],
    ['an offset instead of Z', '2026-10-05T15:00:00+02:00'],
    ['nothing', ''],
  ])('refuses an expiry that is %s', (_what, expiresAt) => {
    expect(() => signApproval(signingKey, { ...claims, expiresAt })).toThrow(
      expect.objectContaining({ code: 'invalid-input' }),
    );
  });

  it('refuses a key of the wrong size', () => {
    expect(() => signApproval(new Uint8Array(16), claims)).toThrow(
      expect.objectContaining({ code: 'invalid-key' }),
    );
  });
});

describe('verifyApproval', () => {
  const sign = (over: Partial<ApprovalClaims> = {}) =>
    signApproval(signingKey, { ...claims, ...over });

  it('accepts a good signature before it expires', () => {
    expect(verifyApproval(signingKey, claims, VECTORS.approvalSignature, before)).toEqual({
      valid: true,
    });
    expect(verifyApproval(signingKey, claims, VECTORS.approvalSignature, new Date(0))).toEqual({
      valid: true,
    });
  });

  it('expires at the instant given, not a moment after', () => {
    expect(verifyApproval(signingKey, claims, VECTORS.approvalSignature, atExpiry)).toEqual({
      valid: false,
      reason: 'expired',
    });
    expect(
      verifyApproval(
        signingKey,
        claims,
        VECTORS.approvalSignature,
        new Date('2026-10-06T00:00:00Z'),
      ),
    ).toEqual({ valid: false, reason: 'expired' });
  });

  it.each([
    ['the approval', { approvalId: ids.approval2 }],
    ['the decision', { decisionId: ids.decision2 }],
    ['the approver', { approverId: ids.user2 }],
    ['the cart', { cartHash: cartHashSchema.parse('0'.repeat(64)) }],
    ['the policy', { policyHash: policyHashSchema.parse('0'.repeat(64)) }],
    ['the expiry, which would extend it', { expiresAt: '2026-10-05T14:00:00Z' }],
    ['the expiry, even by a millisecond', { expiresAt: '2026-10-05T13:00:00.001Z' }],
  ])('rejects a signature when %s is not what was signed', (_what, change) => {
    expect(
      verifyApproval(signingKey, { ...claims, ...change }, VECTORS.approvalSignature, before),
    ).toEqual({
      valid: false,
      reason: 'bad-signature',
    });
  });

  it('does not let a signature for one approval be replayed on another', () => {
    const other = { ...claims, approvalId: ids.approval2 };
    expect(verifyApproval(signingKey, other, VECTORS.approvalSignature, before).valid).toBe(false);
    expect(
      verifyApproval(signingKey, other, sign({ approvalId: ids.approval2 }), before).valid,
    ).toBe(true);
  });

  it('rejects a signature made with another key', () => {
    expect(verifyApproval(testKey(0x81), claims, VECTORS.approvalSignature, before)).toEqual({
      valid: false,
      reason: 'bad-signature',
    });
  });

  it('rejects the signature with any single character changed', () => {
    expect(VECTORS.approvalSignature).toHaveLength(43);
    for (let index = 0; index < VECTORS.approvalSignature.length; index++) {
      const altered = `${VECTORS.approvalSignature.slice(0, index)}${otherChar(VECTORS.approvalSignature.charAt(index), BASE64URL_ALPHABET)}${VECTORS.approvalSignature.slice(index + 1)}`;
      expect(verifyApproval(signingKey, claims, altered, before).valid).toBe(false);
    }
  });

  it.each([
    ['empty', ''],
    ['truncated', VECTORS.approvalSignature.slice(0, -1)],
    ['extended', `${VECTORS.approvalSignature}A`],
    ['padded', `${VECTORS.approvalSignature}=`],
    ['in another case', VECTORS.approvalSignature.toLowerCase()],
    ['surrounded by spaces', ` ${VECTORS.approvalSignature} `],
    [
      'hex instead of base64url',
      Buffer.from(VECTORS.approvalSignature, 'base64url').toString('hex'),
    ],
  ])('rejects a signature that is %s', (_what, signature) => {
    expect(verifyApproval(signingKey, claims, signature, before).valid).toBe(false);
  });

  it('says the signature is bad before it says the approval expired', () => {
    expect(verifyApproval(signingKey, claims, 'forged', atExpiry)).toEqual({
      valid: false,
      reason: 'bad-signature',
    });
  });

  it('refuses a key of the wrong size instead of reporting a bad signature', () => {
    expect(() =>
      verifyApproval(new Uint8Array(0), claims, VECTORS.approvalSignature, before),
    ).toThrow(expect.objectContaining({ code: 'invalid-key' }));
  });
});
