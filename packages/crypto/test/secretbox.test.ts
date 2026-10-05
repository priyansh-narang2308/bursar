import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { fromBase64Url, fromHex, toBase64Url, toHex, utf8 } from '../src/bytes';
import { CryptoError } from '../src/errors';
import {
  aesGcmDecrypt,
  aesGcmEncrypt,
  decryptSecret,
  encryptSecret,
  type Keyring,
  needsRotation,
  parseKeyring,
  resealSecret,
} from '../src/secretbox';
import { BASE64URL_ALPHABET, ids, otherChar, testKey } from './support';
import { VECTORS } from './vectors';

const keyText = (seed: number) => toHex(testKey(seed));
const ring = (spec: string): Keyring => parseKeyring(spec);

const plaintext = 'VAULT-ID-8XJ2K-4';
const context = `mandate:${ids.mandate}`;
const fixedIv = Uint8Array.from({ length: 12 }, (_, index) => 0xa0 + index);

const GOLDEN_SEALED = VECTORS.sealed;

const sealWith = (keyring: Keyring, text = plaintext, where = context) =>
  encryptSecret(keyring, text, where, () => fixedIv);

describe('AES-256-GCM: the published test vector', () => {
  // Test case 16 of "The Galois/Counter Mode of Operation (GCM)" by McGrew and Viega: a 256-bit key,
  // a 96-bit IV, 60 bytes of plaintext and 20 bytes of additional data.
  const key = fromHex('feffe9928665731c6d6a8f9467308308feffe9928665731c6d6a8f9467308308');
  const iv = fromHex('cafebabefacedbaddecaf888');
  const data = fromHex(
    'd9313225f88406e5a55909c5aff5269a86a7a9531534f7da2e4c303d8a318a72' +
      '1c3c0c95956809532fcf0e2449a6b525b16aedf5aa0de657ba637b39',
  );
  const aad = fromHex('feedfacedeadbeeffeedfacedeadbeefabaddad2');
  const sealed = aesGcmEncrypt(key, iv, data, aad);

  it('encrypts to the published ciphertext and tag', () => {
    expect(toHex(sealed.ciphertext)).toBe(
      '522dc1f099567d07f47f37a32a84427d643a8cdcbfe5c0c97598a2bd2555d1aa' +
        '8cb08e48590dbb3da7b08b1056828838c5f61e6393ba7a0abcc9f662',
    );
    expect(toHex(sealed.tag)).toBe('76fc6ece0f4e1768cddf8853bb2d551b');
  });

  it('decrypts it again', () => {
    expect(aesGcmDecrypt(key, iv, sealed.ciphertext, sealed.tag, aad)).toEqual(data);
  });

  it('refuses it with any bit of the ciphertext, tag, IV or additional data changed', () => {
    const parts = { iv, ciphertext: sealed.ciphertext, tag: sealed.tag, aad };
    for (const [name, bytes] of Object.entries(parts)) {
      for (let bit = 0; bit < bytes.length * 8; bit++) {
        const altered = Uint8Array.from(bytes);
        altered[bit >> 3] = (altered[bit >> 3] ?? 0) ^ (1 << (bit & 7));
        const inputs = { ...parts, [name]: altered };
        expect(() =>
          aesGcmDecrypt(key, inputs.iv, inputs.ciphertext, inputs.tag, inputs.aad),
        ).toThrow(expect.objectContaining({ code: 'decryption-failed' }));
      }
    }
  });

  it('refuses it under another key', () => {
    expect(() => aesGcmDecrypt(testKey(1), iv, sealed.ciphertext, sealed.tag, aad)).toThrow(
      expect.objectContaining({ code: 'decryption-failed' }),
    );
  });

  it('refuses a truncated tag, which some libraries accept', () => {
    for (const length of [0, 1, 4, 8, 12, 15]) {
      expect(() =>
        aesGcmDecrypt(key, iv, sealed.ciphertext, sealed.tag.subarray(0, length), aad),
      ).toThrow(expect.objectContaining({ code: 'decryption-failed' }));
    }
  });

  it('refuses a key of the wrong size', () => {
    expect(() => aesGcmEncrypt(new Uint8Array(16), iv, data, aad)).toThrow(
      expect.objectContaining({ code: 'invalid-key' }),
    );
    expect(() => aesGcmDecrypt(new Uint8Array(16), iv, sealed.ciphertext, sealed.tag, aad)).toThrow(
      expect.objectContaining({ code: 'invalid-key' }),
    );
  });
});

describe('parseKeyring', () => {
  it('reads a single bare key as version 1, as `openssl rand -hex 32` writes it', () => {
    const keyring = ring(keyText(1));
    expect(keyring.current.version).toBe(1);
    expect(keyring.current.key).toEqual(testKey(1));
    expect([...keyring.keys.keys()]).toEqual([1]);
  });

  it('reads versioned keys, and the highest version seals', () => {
    const keyring = ring(`1:${keyText(1)},3:${keyText(3)},2:${keyText(2)}`);
    expect(keyring.current).toEqual({ version: 3, key: testKey(3) });
    expect([...keyring.keys.keys()].sort()).toEqual([1, 2, 3]);
    expect(keyring.keys.get(2)).toEqual(testKey(2));
  });

  it('does not depend on the order the keys are listed in', () => {
    expect(ring(`2:${keyText(2)},1:${keyText(1)}`).current.version).toBe(2);
    expect(ring(`1:${keyText(1)},2:${keyText(2)}`).current.version).toBe(2);
  });

  it('accepts one versioned key, base64url keys and spaces around entries', () => {
    expect(ring(`7:${keyText(1)}`).current.version).toBe(7);
    expect(ring(` 2 : ${toBase64Url(testKey(2))} , 1:${keyText(1)} `).current.key).toEqual(
      testKey(2),
    );
  });

  it.each([
    ['nothing', ''],
    ['a key of the wrong size', `1:${keyText(1).slice(2)}`],
    ['a bare key among several', `${keyText(1)},2:${keyText(2)}`],
    ['a trailing comma', `1:${keyText(1)},`],
    ['a repeated version', `1:${keyText(1)},1:${keyText(2)}`],
    ['version 0', `0:${keyText(1)}`],
    ['a version with a leading zero', `01:${keyText(1)}`],
    ['a negative version', `-1:${keyText(1)}`],
    ['a version that is not a number', `x:${keyText(1)}`],
    ['a version too large to be sensible', `1000000000:${keyText(1)}`],
    ['an empty version', `:${keyText(1)}`],
    ['an empty key', '1:'],
  ])('refuses %s', (_what, spec) => {
    expect(() => parseKeyring(spec)).toThrow(expect.objectContaining({ code: 'invalid-key' }));
  });

  it('never repeats the key text in an error', () => {
    const bad = `1:${keyText(1).slice(0, 63)}!`;
    expect(() => parseKeyring(bad)).toThrow(CryptoError);
    expect(() => parseKeyring(bad)).not.toThrow(keyText(1).slice(0, 20));
  });
});

describe('encryptSecret and decryptSecret', () => {
  const keyring = ring(keyText(0xc0));

  it('matches the independently computed sealed value', () => {
    expect(sealWith(keyring)).toBe(GOLDEN_SEALED);
    expect(decryptSecret(keyring, GOLDEN_SEALED, context)).toBe(plaintext);
  });

  it('round-trips, with a different sealed value each time', () => {
    const a = encryptSecret(keyring, plaintext, context);
    const b = encryptSecret(keyring, plaintext, context);
    expect(a).not.toBe(b);
    expect(decryptSecret(keyring, a, context)).toBe(plaintext);
    expect(decryptSecret(keyring, b, context)).toBe(plaintext);
  });

  it('round-trips any text, including a leading byte order mark and non-ASCII', () => {
    for (const text of ['﻿x', 'ß€😀', ' padded ', 'a\nb', '\u0000']) {
      expect(decryptSecret(keyring, encryptSecret(keyring, text, context), context)).toBe(text);
    }
    fc.assert(
      fc.property(
        fc.string({ unit: 'grapheme', minLength: 1, maxLength: 40 }),
        fc.string({ unit: 'grapheme', minLength: 1, maxLength: 40 }),
        (text, where) => {
          expect(decryptSecret(keyring, encryptSecret(keyring, text, where), where)).toBe(text);
        },
      ),
    );
  });

  it('writes the key version, the IV, the ciphertext and the tag', () => {
    const [scheme, name, version, keyVersion, iv, ciphertext, tag] = GOLDEN_SEALED.split(':');
    expect([scheme, name, version, keyVersion]).toEqual(['bursar', 'secret', 'v1', '1']);
    expect(fromBase64Url(iv ?? '')).toEqual(fixedIv);
    expect(fromBase64Url(ciphertext ?? '')).toHaveLength(utf8(plaintext).length);
    expect(fromBase64Url(tag ?? '')).toHaveLength(16);
  });

  describe('tamper evidence', () => {
    const [prefix, iv, ciphertext, tag] = [
      GOLDEN_SEALED.split(':').slice(0, 4).join(':'),
      ...GOLDEN_SEALED.split(':').slice(4),
    ];
    const parts = {
      iv: fromBase64Url(iv ?? ''),
      ciphertext: fromBase64Url(ciphertext ?? ''),
      tag: fromBase64Url(tag ?? ''),
    };
    const assemble = (changed: typeof parts) =>
      [prefix, ...[changed.iv, changed.ciphertext, changed.tag].map(toBase64Url)].join(':');

    it.each(Object.keys(parts) as Array<keyof typeof parts>)(
      'refuses the %s with any single bit flipped',
      (name) => {
        const original = parts[name];
        for (let bit = 0; bit < original.length * 8; bit++) {
          const altered = Uint8Array.from(original);
          altered[bit >> 3] = (altered[bit >> 3] ?? 0) ^ (1 << (bit & 7));
          expect(() =>
            decryptSecret(keyring, assemble({ ...parts, [name]: altered }), context),
          ).toThrow(expect.objectContaining({ code: 'decryption-failed' }));
        }
      },
    );

    it('refuses the text with any single character changed, and never yields a value', () => {
      for (let index = 0; index < GOLDEN_SEALED.length; index++) {
        const altered = `${GOLDEN_SEALED.slice(0, index)}${otherChar(GOLDEN_SEALED.charAt(index), `${BASE64URL_ALPHABET}:`)}${GOLDEN_SEALED.slice(index + 1)}`;
        expect(() => decryptSecret(keyring, altered, context)).toThrow(CryptoError);
      }
    });

    it('refuses a ciphertext cut short or extended', () => {
      for (const changed of [parts.ciphertext.subarray(1), Uint8Array.of(...parts.ciphertext, 0)]) {
        expect(() =>
          decryptSecret(keyring, assemble({ ...parts, ciphertext: changed }), context),
        ).toThrow(expect.objectContaining({ code: 'decryption-failed' }));
      }
    });

    it('refuses another context: a value moved to another row will not open', () => {
      for (const other of [`mandate:${ids.org}`, context.toUpperCase(), `${context} `, 'x']) {
        expect(() => decryptSecret(keyring, GOLDEN_SEALED, other)).toThrow(
          expect.objectContaining({ code: 'decryption-failed' }),
        );
      }
    });

    it('refuses another key', () => {
      expect(() => decryptSecret(ring(keyText(0xc1)), GOLDEN_SEALED, context)).toThrow(
        expect.objectContaining({ code: 'decryption-failed' }),
      );
    });

    it('authenticates the key version: relabelling it fails even if both versions share a key', () => {
      const sameKey = ring(`2:${keyText(0xc0)},1:${keyText(0xc0)}`);
      const relabelled = GOLDEN_SEALED.replace(':v1:1:', ':v1:2:');
      expect(() => decryptSecret(sameKey, relabelled, context)).toThrow(
        expect.objectContaining({ code: 'decryption-failed' }),
      );
      expect(decryptSecret(sameKey, GOLDEN_SEALED, context)).toBe(plaintext);
    });

    it('says the same thing whatever went wrong, and never repeats the secret or the key', () => {
      const messageOf = (attempt: () => unknown): string => {
        try {
          attempt();
        } catch (error) {
          return error instanceof CryptoError ? error.message : 'not a CryptoError';
        }
        return 'did not throw';
      };
      const messages = [
        () => decryptSecret(ring(keyText(0xc1)), GOLDEN_SEALED, context),
        () => decryptSecret(keyring, GOLDEN_SEALED, 'other'),
        () => decryptSecret(keyring, assemble({ ...parts, tag: new Uint8Array(16) }), context),
        () => decryptSecret(keyring, assemble({ ...parts, iv: new Uint8Array(12) }), context),
      ].map(messageOf);
      expect(new Set(messages).size).toBe(1);
      expect(messages[0]).toContain('could not be decrypted');
      expect(messages[0]).not.toContain(plaintext);
      expect(messages[0]).not.toContain(keyText(0xc0));
    });
  });

  describe('what is not a sealed secret', () => {
    const [head] = GOLDEN_SEALED.split(':1:');
    const [, iv, ciphertext, tag] = GOLDEN_SEALED.split(':').slice(3);
    it.each([
      ['empty', ''],
      ['plain text', plaintext],
      ['a part missing', GOLDEN_SEALED.split(':').slice(0, -1).join(':')],
      ['a part added', `${GOLDEN_SEALED}:AAAA`],
      ['another format version', GOLDEN_SEALED.replace(':v1:', ':v2:')],
      ['another prefix', GOLDEN_SEALED.replace('bursar', 'Bursar')],
      ['version 0', GOLDEN_SEALED.replace(':v1:1:', ':v1:0:')],
      ['a version with a leading zero', GOLDEN_SEALED.replace(':v1:1:', ':v1:01:')],
      ['an IV of the wrong length', `${head}:1:${iv?.slice(1)}:${ciphertext}:${tag}`],
      ['a tag of the wrong length', `${head}:1:${iv}:${ciphertext}:${tag?.slice(1)}`],
      ['an empty ciphertext', `${head}:1:${iv}::${tag}`],
      ['the standard base64 alphabet', GOLDEN_SEALED.replace('gHZALcd-', 'gHZALcd+')],
      ['spare bits that are not zero', GOLDEN_SEALED.replace(/.$/, 'R')],
      ['leading whitespace', ` ${GOLDEN_SEALED}`],
      ['a trailing newline', `${GOLDEN_SEALED}\n`],
    ])('refuses %s', (_what, text) => {
      expect(() => decryptSecret(keyring, text, context)).toThrow(
        expect.objectContaining({ code: 'invalid-input' }),
      );
      expect(() => needsRotation(keyring, text)).toThrow(CryptoError);
    });

    it('refuses a ciphertext too long to be a secret', () => {
      const long = `${head}:1:${iv}:${'A'.repeat(5463)}:${tag}`;
      expect(() => decryptSecret(keyring, long, context)).toThrow(
        expect.objectContaining({ code: 'invalid-input' }),
      );
    });
  });

  describe('what may be sealed', () => {
    it('allows 1 to 4096 bytes of text', () => {
      expect(decryptSecret(keyring, encryptSecret(keyring, 'x', context), context)).toBe('x');
      const biggest = 'x'.repeat(4096);
      expect(decryptSecret(keyring, encryptSecret(keyring, biggest, context), context)).toBe(
        biggest,
      );
    });

    it.each([
      ['nothing', ''],
      ['too much text', 'x'.repeat(4097)],
      ['too many bytes of multibyte text', '€'.repeat(1366)],
      ['a lone surrogate, which would not survive UTF-8', 'x\ud800'],
    ])('refuses %s', (_what, text) => {
      expect(() => encryptSecret(keyring, text, context)).toThrow(
        expect.objectContaining({ code: 'invalid-input' }),
      );
    });

    it('requires a context, because a secret bound to nothing can be moved anywhere', () => {
      for (const where of ['', 'x\udc00']) {
        expect(() => encryptSecret(keyring, plaintext, where)).toThrow(
          expect.objectContaining({ code: 'invalid-input' }),
        );
        expect(() => decryptSecret(keyring, GOLDEN_SEALED, where)).toThrow(
          expect.objectContaining({ code: 'invalid-input' }),
        );
      }
    });

    it('insists on a 96-bit IV from the random source', () => {
      for (const length of [0, 11, 13, 16]) {
        expect(() =>
          encryptSecret(keyring, plaintext, context, () => new Uint8Array(length)),
        ).toThrow(expect.objectContaining({ code: 'invalid-input' }));
      }
    });

    it('refuses a keyring whose key is the wrong size', () => {
      const broken: Keyring = { current: { version: 1, key: new Uint8Array(8) }, keys: new Map() };
      expect(() => encryptSecret(broken, plaintext, context)).toThrow(
        expect.objectContaining({ code: 'invalid-key' }),
      );
    });
  });
});

describe('key rotation', () => {
  const oldRing = ring(`1:${keyText(1)}`);
  const newRing = ring(`2:${keyText(2)},1:${keyText(1)}`);
  const retiredRing = ring(`2:${keyText(2)}`);
  const sealedOld = encryptSecret(oldRing, plaintext, context);

  it('seals new secrets under the newest key', () => {
    expect(encryptSecret(newRing, plaintext, context)).toMatch(/^bursar:secret:v1:2:/);
  });

  it('still opens secrets sealed under an older key that is kept', () => {
    expect(decryptSecret(newRing, sealedOld, context)).toBe(plaintext);
  });

  it('knows which secrets need re-sealing', () => {
    expect(needsRotation(newRing, sealedOld)).toBe(true);
    expect(needsRotation(oldRing, sealedOld)).toBe(false);
    expect(needsRotation(newRing, encryptSecret(newRing, plaintext, context))).toBe(false);
  });

  it('re-seals under the newest key, after which the old key can be retired', () => {
    const resealed = resealSecret(newRing, sealedOld, context);
    expect(resealed).toMatch(/^bursar:secret:v1:2:/);
    expect(needsRotation(newRing, resealed)).toBe(false);
    expect(decryptSecret(retiredRing, resealed, context)).toBe(plaintext);
  });

  it('cannot re-seal into another context', () => {
    expect(() => resealSecret(newRing, sealedOld, 'elsewhere')).toThrow(
      expect.objectContaining({ code: 'decryption-failed' }),
    );
  });

  it('says so, with a different error, if the key was retired too early', () => {
    expect(() => decryptSecret(retiredRing, sealedOld, context)).toThrow(
      expect.objectContaining({ code: 'unknown-key-version' }),
    );
    expect(() => resealSecret(retiredRing, sealedOld, context)).toThrow(
      expect.objectContaining({ code: 'unknown-key-version' }),
    );
  });

  it('uses the random source it is given when re-sealing', () => {
    expect(resealSecret(newRing, sealedOld, context, () => fixedIv)).toBe(
      encryptSecret(newRing, plaintext, context, () => fixedIv),
    );
  });
});
