/** Conventional Commit types accepted by this repository. */
export const COMMIT_TYPES = [
  'feat',
  'fix',
  'docs',
  'style',
  'refactor',
  'perf',
  'test',
  'build',
  'ci',
  'chore',
  'revert',
] as const;

export type CommitType = (typeof COMMIT_TYPES)[number];

export interface CommitMessageResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
}

/** Headers that git itself generates; they are accepted as-is. */
const GENERATED_HEADERS: readonly RegExp[] = [/^Merge /, /^Revert "/, /^(?:fixup|squash|amend)! /];

const MAX_HEADER_LENGTH = 100;

const HEADER_PATTERN = new RegExp(
  `^(?:${COMMIT_TYPES.join('|')})(?:\\([a-z0-9][a-z0-9-]*\\))?!?: \\S.*$`,
);

/** Mirrors `git commit` cleanup: drop comment lines and leading blank lines. */
function cleanup(raw: string): string[] {
  const lines = raw
    .replace(/\r\n/g, '\n')
    .split('\n')
    .filter((line) => !line.startsWith('#'));
  while (lines[0]?.trim() === '') {
    lines.shift();
  }
  return lines;
}

/**
 * Validates a commit message against the Conventional Commits subset used here:
 * `<type>(<optional-scope>)!: <subject>`, header at most 100 characters, no trailing
 * period, and a blank line before any body. Merge, revert and fixup headers that git
 * generates are accepted unchanged.
 */
export function validateCommitMessage(raw: string): CommitMessageResult {
  const lines = cleanup(raw);
  const header = lines[0];

  if (header === undefined || header.trim() === '') {
    return { valid: false, errors: ['The commit message is empty.'] };
  }
  if (GENERATED_HEADERS.some((pattern) => pattern.test(header))) {
    return { valid: true, errors: [] };
  }

  const errors: string[] = [];
  if (!HEADER_PATTERN.test(header)) {
    errors.push(
      'The header must look like "<type>(<scope>)!: <subject>": a lowercase type from the allowed list, an optional lowercase kebab-case scope, an optional "!" for breaking changes, and a non-empty subject after ": ".',
    );
  }
  if (header.length > MAX_HEADER_LENGTH) {
    errors.push(
      `The header is ${header.length} characters long; the limit is ${MAX_HEADER_LENGTH}.`,
    );
  }
  if (header.trimEnd().endsWith('.')) {
    errors.push('The subject must not end with a period.');
  }
  const second = lines[1];
  if (second !== undefined && second.trim() !== '') {
    errors.push('Leave a blank line between the header and the body.');
  }

  return { valid: errors.length === 0, errors };
}
