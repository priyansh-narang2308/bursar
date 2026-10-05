import { readFileSync } from 'node:fs';
import { COMMIT_TYPES, validateCommitMessage } from '@bursar/tooling';

const messageFile = process.argv[2];
if (messageFile === undefined) {
  console.error('commit-msg hook: expected the path of the commit message file as an argument.');
  process.exit(2);
}

const result = validateCommitMessage(readFileSync(messageFile, 'utf8'));
if (!result.valid) {
  console.error(
    [
      '',
      '✖ Commit message rejected:',
      ...result.errors.map((error) => `  - ${error}`),
      '',
      'Expected: <type>(<optional-scope>)!: <subject>',
      `Types:    ${COMMIT_TYPES.join(', ')}`,
      'Example:  feat(policy): add the structuring rule',
      '',
    ].join('\n'),
  );
  process.exit(1);
}
