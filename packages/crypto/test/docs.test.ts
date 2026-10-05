import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as api from '../src';
import { DOMAINS } from '../src/domains';
import { BURSAR_NAMESPACE } from '../src/uuid';
import { VECTORS } from './vectors';

const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');

describe('README', () => {
  it.each(Object.keys(api).filter((name) => !name.startsWith('systemRandom')))(
    'documents the export %s',
    (name) => {
      expect(readme).toContain(`\`${name}\``);
    },
  );

  it('documents the default source of randomness', () => {
    expect(readme).toContain('`systemRandomBytes`');
  });

  it.each(Object.entries(VECTORS))(
    'quotes the reference value for %s, so it cannot go stale',
    (_name, value) => {
      expect(readme).toContain(value);
    },
  );

  it.each(Object.entries(DOMAINS))('lists the label of the %s purpose', (_purpose, label) => {
    expect(readme).toContain(`\`${label}\``);
  });

  it('states the namespace its request ids use', () => {
    expect(readme).toContain(BURSAR_NAMESPACE);
  });

  it('documents every error code', () => {
    for (const code of [
      'invalid-input',
      'invalid-key',
      'unknown-key-version',
      'decryption-failed',
    ]) {
      expect(readme).toContain(`\`${code}\``);
    }
  });
});
