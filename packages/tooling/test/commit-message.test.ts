import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { COMMIT_TYPES, validateCommitMessage } from '../src/commit-message';

describe('validateCommitMessage', () => {
  it.each([
    ['a plain feature', 'feat: add the money package'],
    ['a scoped fix', 'fix(db): reject unbalanced ledger entries'],
    ['a breaking change', 'refactor(policy)!: rename the evaluate options'],
    ['a breaking change without a scope', 'chore!: drop Node 22'],
    [
      'a body and trailers',
      'feat(api): add health checks\n\nExplain why.\n\nCo-Authored-By: Someone <someone@example.com>',
    ],
    ['a trailing newline', 'docs: explain the stack\n'],
    ['windows line endings', 'docs: explain the stack\r\n\r\nBody.\r\n'],
    [
      'git comment lines',
      'feat: add a thing\n# Please enter the commit message\n# Lines starting with # are ignored',
    ],
    ['leading blank lines', '\n\nfeat: add a thing'],
    ['a merge commit', "Merge branch 'develop' into main"],
    ['a revert commit', 'Revert "feat: add a thing"'],
    ['a fixup commit', 'fixup! feat: add a thing'],
  ])('accepts %s', (_label, message) => {
    expect(validateCommitMessage(message)).toEqual({ valid: true, errors: [] });
  });

  it.each([
    ['an empty message', '', 'empty'],
    ['only comments', '# nothing to see here', 'empty'],
    ['no type', 'add the money package', 'header must look like'],
    ['an unknown type', 'feature: add a thing', 'header must look like'],
    ['an uppercase type', 'Feat: add a thing', 'header must look like'],
    ['a missing space after the colon', 'feat:add a thing', 'header must look like'],
    ['an empty subject', 'feat: ', 'header must look like'],
    ['an uppercase scope', 'feat(DB): add a thing', 'header must look like'],
    ['a trailing period', 'feat: add a thing.', 'must not end with a period'],
    ['an over-long header', `feat: ${'x'.repeat(100)}`, 'limit is 100'],
    ['a body without a blank line', 'feat: add a thing\nbody starts too early', 'blank line'],
  ])('rejects %s', (_label, message, expectedError) => {
    const result = validateCommitMessage(message);
    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toContain(expectedError);
  });

  it('reports every problem at once', () => {
    const result = validateCommitMessage(`Feat: ${'x'.repeat(100)}.\nno blank line`);
    expect(result.errors).toHaveLength(4);
  });

  describe('properties', () => {
    const scope = fc.stringMatching(/^[a-z0-9][a-z0-9-]{0,15}$/);
    const subject = fc.stringMatching(/^[A-Za-z0-9][A-Za-z0-9 ,'_-]{0,60}[A-Za-z0-9]$/);

    it('accepts every well-formed header', () => {
      fc.assert(
        fc.property(
          fc.constantFrom(...COMMIT_TYPES),
          fc.option(scope, { nil: undefined }),
          fc.boolean(),
          subject,
          (type, maybeScope, breaking, text) => {
            const scopePart = maybeScope === undefined ? '' : `(${maybeScope})`;
            const header = `${type}${scopePart}${breaking ? '!' : ''}: ${text}`;
            expect(validateCommitMessage(header).valid).toBe(true);
          },
        ),
      );
    });

    it('rejects any header whose type is not on the allowed list', () => {
      const unknownType = fc
        .stringMatching(/^[a-z]{2,12}$/)
        .filter((candidate) => !(COMMIT_TYPES as readonly string[]).includes(candidate));
      fc.assert(
        fc.property(unknownType, subject, (type, text) => {
          expect(validateCommitMessage(`${type}: ${text}`).valid).toBe(false);
        }),
      );
    });
  });
});
