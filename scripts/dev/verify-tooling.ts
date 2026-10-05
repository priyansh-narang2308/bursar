/**
 * Checks the developer environment: runtimes, Claude Code plugins, sponsor skills and a few
 * optional binaries. All decisions live in `@bursar/tooling` (pure, tested); this file only
 * gathers facts from the machine.
 *
 *   pnpm dev:doctor            human-readable report
 *   pnpm dev:doctor --strict   warnings also fail
 *   pnpm dev:doctor --json     machine-readable output
 */
import { execFile } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { promisify } from 'node:util';
import {
  type CheckResult,
  checkBinaries,
  checkClaudeCli,
  checkNode,
  checkPlugins,
  checkPnpm,
  checkSkills,
  DEV_BINARIES,
  exitCodeFor,
  parsePluginList,
  parseRootManifest,
  parseSkillsLock,
  renderReport,
  summarize,
} from '@bursar/tooling';
import { installedSkillNames, repoRoot } from './shared';

const execFileAsync = promisify(execFile);

/** Runs a command and returns its trimmed stdout, or undefined when it is missing or fails. */
async function tryRun(command: string, args: readonly string[]): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync(command, [...args], { cwd: repoRoot, timeout: 20_000 });
    return stdout.trim();
  } catch {
    return undefined;
  }
}

/** Skills and commands a plugin ships; Claude Code exposes both as invocable skills. */
async function pluginSkillNames(installPath: string): Promise<string[]> {
  const skills = await readdir(join(installPath, 'skills'), { recursive: true }).catch(() => []);
  const commands = await readdir(join(installPath, 'commands')).catch(() => []);
  return [
    ...skills
      .filter((entry) => basename(entry) === 'SKILL.md')
      .map((entry) => basename(dirname(entry))),
    ...commands.filter((entry) => entry.endsWith('.md')).map((entry) => basename(entry, '.md')),
  ];
}

async function pluginResults(): Promise<CheckResult[]> {
  const listing = await tryRun('claude', ['plugin', 'list', '--json']);
  if (listing === undefined) {
    return [
      {
        id: 'plugins',
        title: 'Claude Code plugins',
        status: 'fail',
        detail: '`claude plugin list --json` failed',
        fix: 'Run it by hand to see the error',
      },
    ];
  }
  const installed = parsePluginList(listing);
  const skillsByPlugin = Object.fromEntries(
    await Promise.all(
      installed.map(
        async (plugin) => [plugin.id, await pluginSkillNames(plugin.installPath)] as const,
      ),
    ),
  );
  return checkPlugins(installed, {
    // Only whether the token exists is read; its value is never printed or stored.
    sandboxTokenPresent: Boolean(process.env['PAYPAL_SANDBOX_ACCESS_TOKEN']),
    skillsByPlugin,
  });
}

async function skillsResult(): Promise<CheckResult> {
  try {
    const lock = parseSkillsLock(await readFile(join(repoRoot, 'skills-lock.json'), 'utf8'));
    return checkSkills(lock, await installedSkillNames());
  } catch (error) {
    return {
      id: 'skills',
      title: 'Sponsor skills',
      status: 'fail',
      detail: `cannot read skills-lock.json: ${error instanceof Error ? error.message : String(error)}`,
      fix: 'Restore skills-lock.json from git, then run: pnpm dev:skills',
    };
  }
}

async function probeBinaries(): Promise<Map<string, string>> {
  const found = new Map<string, string>();
  await Promise.all(
    DEV_BINARIES.map(async ({ name }) => {
      if ((await tryRun('which', [name])) === undefined) {
        return;
      }
      const firstLine = (await tryRun(name, ['--version']))?.split('\n')[0];
      found.set(name, firstLine === undefined || firstLine === '' ? 'installed' : firstLine);
    }),
  );
  return found;
}

async function collect(): Promise<CheckResult[]> {
  const manifest = parseRootManifest(await readFile(join(repoRoot, 'package.json'), 'utf8'));
  const claudeVersion = await tryRun('claude', ['--version']);

  const results: CheckResult[] = [
    checkNode(process.version, manifest.nodeRange),
    checkPnpm(await tryRun('pnpm', ['--version']), manifest.packageManager),
    checkClaudeCli(claudeVersion),
  ];
  if (claudeVersion !== undefined) {
    results.push(...(await pluginResults()));
  }
  results.push(await skillsResult(), ...checkBinaries(await probeBinaries()));
  return results;
}

const flags = new Set(process.argv.slice(2));
const results = await collect();

console.log(
  flags.has('--json')
    ? JSON.stringify({ results, summary: summarize(results) }, null, 2)
    : renderReport(results),
);
process.exitCode = exitCodeFor(results, flags.has('--strict'));
