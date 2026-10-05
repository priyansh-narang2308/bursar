/**
 * Installs the sponsor skills recorded in `skills-lock.json` into `.claude/skills`.
 *
 * Third-party skill files are deliberately not committed (one pack has no licence), so this
 * is how a fresh clone gets them. The lock file is the single source of truth for which
 * skills come from which repository.
 *
 *   pnpm dev:skills             install whatever is missing
 *   pnpm dev:skills --dry-run   print the commands without running them
 *   pnpm dev:skills --force     reinstall everything in the lock file
 */
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { groupSkillsBySource, parseSkillsLock } from '@bursar/tooling';
import { installedSkillNames, repoRoot } from './shared';

/** Pinned so everyone installs through the same, reviewed version of the CLI. */
const SKILLS_CLI = 'skills@1.7.0';

const flags = new Set(process.argv.slice(2));
const dryRun = flags.has('--dry-run');
const force = flags.has('--force');

function runInherited(command: string, args: readonly string[]): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, [...args], {
      cwd: repoRoot,
      stdio: 'inherit',
      // Opt out of the installer's anonymous usage telemetry.
      env: { ...process.env, DO_NOT_TRACK: '1', DISABLE_TELEMETRY: '1' },
    });
    child.on('error', reject);
    child.on('close', (code) => resolve(code ?? 1));
  });
}

const lock = parseSkillsLock(await readFile(join(repoRoot, 'skills-lock.json'), 'utf8'));
const installed = await installedSkillNames();

for (const [source, names] of groupSkillsBySource(lock)) {
  const wanted = force ? names : names.filter((name) => !installed.has(name));
  if (wanted.length === 0) {
    console.log(`✓ ${source}: all ${names.length} skill(s) already installed`);
    continue;
  }

  const args = [
    '-y',
    SKILLS_CLI,
    'add',
    source,
    ...wanted.flatMap((name) => ['-s', name]),
    '-a',
    'claude-code',
    '--copy',
    '-y',
  ];
  console.log(`→ npx ${args.join(' ')}`);
  if (dryRun) {
    continue;
  }

  const code = await runInherited('npx', args);
  if (code !== 0) {
    console.error(`✖ ${source}: the installer exited with code ${code}`);
    process.exit(code);
  }
}
