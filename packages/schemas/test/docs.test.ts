import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  ACTION_STATES,
  ACTION_TRANSITIONS,
  ERROR_CATALOG,
  ERROR_CODES,
  ID_PREFIXES,
  isId,
  isRetryable,
  LLM_TOOLS,
  MAX_CART_LINES,
  MAX_LINE_QUANTITY,
  MAX_SEARCH_RESULTS,
  SSE_EVENT_TYPES,
} from '../src';

/*
 * The README's tables and diagram are compared with the code, so documentation that has drifted
 * fails a test instead of misleading a reader. Cells are trimmed, so a formatter that pads the
 * columns does not matter.
 */

const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');

/** The rows of the first table after the heading, without the header row and the divider. */
function tableUnder(heading: string): string[][] {
  const lines = readme.split('\n');
  const start = lines.findIndex(
    (line) => line.replace(/^#+\s*/, '') === heading && line.startsWith('#'),
  );
  if (start === -1) {
    throw new Error(`No heading "${heading}" in the README.`);
  }
  const rows = lines
    .slice(start + 1)
    .filter((line) => line.startsWith('|') || line.trim() === '')
    .join('\n')
    .split(/\n\n+/)
    .find((block) => block.startsWith('|'));
  if (rows === undefined) {
    throw new Error(`No table under "${heading}".`);
  }
  return rows
    .split('\n')
    .slice(2)
    .map((row) =>
      row
        .split('|')
        .slice(1, -1)
        .map((cell) => cell.trim()),
    );
}

describe('the README', () => {
  it('lists every kind of identifier with its prefix', () => {
    const rows = tableUnder('Identifiers');

    expect(Object.fromEntries(rows.map(([kind, prefix]) => [kind, prefix]))).toEqual(ID_PREFIXES);
  });

  it('shows an example id that is a valid action id', () => {
    const example = /newId\('action'\); \/\/ '([^']+)'/.exec(readme)?.[1];

    expect(isId('action', example)).toBe(true);
  });

  it('lists every error code with its status and whether it can be retried', () => {
    const rows = tableUnder('Error catalog');

    expect(rows.map(([code]) => code)).toEqual([...ERROR_CODES]);
    for (const [code, status, retry, meaning] of rows) {
      const known = ERROR_CODES.find((candidate) => candidate === code);

      expect(known, `${code} is not in the catalog`).toBeDefined();
      if (known !== undefined) {
        expect(Number(status)).toBe(ERROR_CATALOG[known].status);
        expect(retry === 'yes').toBe(isRetryable(known));
      }
      expect(meaning?.length).toBeGreaterThan(0);
    }
  });

  it('lists every LLM tool with its effect, and states the limits the code enforces', () => {
    const rows = tableUnder('What an LLM may call');

    expect(Object.fromEntries(rows.map(([tool, effect]) => [tool, effect]))).toEqual(
      Object.fromEntries(Object.entries(LLM_TOOLS).map(([name, tool]) => [name, tool.effect])),
    );
    const text = rows.map((row) => row.join(' ')).join('\n');

    expect(text).toContain(`up to ${MAX_CART_LINES} lines`);
    expect(text).toContain(`quantity (1 to ${MAX_LINE_QUANTITY})`);
    expect(text).toContain(`results (1 to ${MAX_SEARCH_RESULTS})`);
  });

  it('lists every event on the live stream', () => {
    expect(tableUnder('Live events').map(([event]) => event)).toEqual([...SSE_EVENT_TYPES]);
  });

  it('draws the action lifecycle exactly as the transition table says', () => {
    const diagram = /```mermaid\n([\s\S]*?)```/.exec(readme)?.[1] ?? '';
    const drawn = [...diagram.matchAll(/^\s*(\w+) --> (\w+)\s*$/gm)].map(
      ([, from, to]) => `${from} ${to}`,
    );
    const real = ACTION_STATES.flatMap((from) =>
      ACTION_TRANSITIONS[from].map((to) => `${from} ${to}`),
    );

    expect(drawn.sort()).toEqual(real.sort());
  });
});
