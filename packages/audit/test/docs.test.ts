import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as api from '../src';
import { MAX_AUDIT_PAYLOAD_BYTES } from '../src';
import { GOLDEN_CHAIN, GOLDEN_GENESIS } from './vectors';

const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');

describe('README', () => {
  it.each(Object.keys(api))('documents the export %s', (name) => {
    expect(readme).toContain(`\`${name}\``);
  });

  it('quotes the reference hashes, so they cannot go stale', () => {
    expect(readme).toContain(GOLDEN_GENESIS);
    for (const event of GOLDEN_CHAIN) {
      expect(readme).toContain(event.hash);
    }
  });

  it.each(api.CHAIN_FAILURES)('explains the failure %s', (reason) => {
    expect(readme).toContain(`\`${reason}\``);
  });

  it('states the largest payload', () => {
    expect(readme).toContain(String(MAX_AUDIT_PAYLOAD_BYTES));
  });

  it('documents every error code', () => {
    for (const code of ['invalid-head', 'invalid-event', 'payload-too-large']) {
      expect(readme).toContain(`\`${code}\``);
    }
  });
});
