import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(import.meta.dirname, '..', '..', '..');
const straight = (text: string) => text.replaceAll('’', "'");

function testFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (name === 'node_modules' || name === '.claude' || name === 'dist') return [];
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return testFiles(path);
    return /\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

describe('docs/threat-model.md', () => {
  it('cites only tests that exist: every quoted title is a real test title', () => {
    const doc = readFileSync(join(root, 'docs', 'threat-model.md'), 'utf8');
    const titles = [...doc.matchAll(/"([^"]{12,})"/g)].map((m) => m[1] ?? '');
    const source = straight(
      testFiles(root)
        .map((file) => readFileSync(file, 'utf8'))
        .join('\n'),
    );
    expect(titles.length).toBeGreaterThan(20);
    const missing = titles.filter((title) => !source.includes(straight(title)));
    expect(missing).toEqual([]);
  });
});
