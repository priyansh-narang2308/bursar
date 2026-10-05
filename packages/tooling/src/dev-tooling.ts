/**
 * Rules for checking a developer's AI tooling setup (Claude Code plugins, skills and a few
 * binaries). Everything here is pure: the I/O (spawning `claude`, reading the lock file,
 * probing binaries) lives in `scripts/dev/verify-tooling.ts`, so each rule can be tested
 * exhaustively without a machine that has the tools installed.
 */
import { createHash } from 'node:crypto';

export type CheckStatus = 'pass' | 'warn' | 'fail';

export interface CheckResult {
  readonly id: string;
  readonly title: string;
  readonly status: CheckStatus;
  readonly detail: string;
  /** A command or instruction that resolves a warning or failure. */
  readonly fix?: string;
}

function result(
  id: string,
  title: string,
  status: CheckStatus,
  detail: string,
  fix?: string,
): CheckResult {
  return fix === undefined ? { id, title, status, detail } : { id, title, status, detail, fix };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// ---------------------------------------------------------------------------------------
// Node.js
// ---------------------------------------------------------------------------------------

/** Major versions named by a `^M.x.y || ^N.x.y` engines range. */
export function supportedNodeMajors(enginesRange: string): number[] {
  return [...enginesRange.matchAll(/\^(\d+)\./g)].map((match) => Number(match[1]));
}

export function checkNode(version: string, enginesRange: string): CheckResult {
  const major = Number(/^v?(\d+)\./.exec(version)?.[1]);
  const supported = supportedNodeMajors(enginesRange);
  const detail = `${version} (supported: ${enginesRange})`;

  return supported.includes(major)
    ? result('node', 'Node.js', 'pass', detail)
    : result(
        'node',
        'Node.js',
        'fail',
        detail,
        'Install a supported Node.js version, for example: nvm install 24',
      );
}

export interface RootManifest {
  readonly nodeRange: string;
  readonly packageManager: string;
}

/** Reads the two runtime pins the checks compare against from the root `package.json`. */
export function parseRootManifest(json: string): RootManifest {
  const data: unknown = JSON.parse(json);
  const engines = isRecord(data) ? data['engines'] : undefined;
  const nodeRange = isRecord(engines) ? engines['node'] : undefined;
  const packageManager = isRecord(data) ? data['packageManager'] : undefined;
  if (typeof nodeRange !== 'string' || typeof packageManager !== 'string') {
    throw new TypeError('package.json must declare "engines.node" and "packageManager".');
  }
  return { nodeRange, packageManager };
}

/** `running` is the output of `pnpm --version`, or undefined when pnpm is not installed. */
export function checkPnpm(running: string | undefined, packageManager: string): CheckResult {
  const pinned = /^pnpm@(\d+\.\d+\.\d+)$/.exec(packageManager)?.[1];
  if (running === undefined) {
    return result(
      'pnpm',
      'pnpm',
      'fail',
      'not installed',
      'Install pnpm: https://pnpm.io/installation',
    );
  }
  if (pinned === undefined) {
    return result(
      'pnpm',
      'pnpm',
      'warn',
      `${running}, but packageManager is not an exact pnpm version`,
      'Pin it, for example "pnpm@11.8.0"',
    );
  }
  return running === pinned
    ? result('pnpm', 'pnpm', 'pass', `${running} (pinned in package.json)`)
    : result(
        'pnpm',
        'pnpm',
        'warn',
        `${running} differs from the pinned ${pinned}; pnpm switches to the pinned version automatically`,
        `pnpm self-update ${pinned}`,
      );
}

/** `version` is the output of `claude --version`, or undefined when the CLI is not installed. */
export function checkClaudeCli(version: string | undefined): CheckResult {
  return version === undefined
    ? result(
        'claude',
        'Claude Code',
        'fail',
        'the `claude` CLI is not on PATH',
        'Install Claude Code: https://claude.com/claude-code',
      )
    : result('claude', 'Claude Code', 'pass', version);
}

// ---------------------------------------------------------------------------------------
// Claude Code plugins
// ---------------------------------------------------------------------------------------

/** The APIMatic Context Plugin for the PayPal Server SDK, enabled for this project. */
export const APIMATIC_PLUGIN_ID = 'paypal@context-plugins';

/** PayPal's own AI Toolkit, installed locally and enabled only for PayPal-heavy work. */
export const PAYPAL_TOOLKIT_PLUGIN_ID = 'paypal@claude-plugins-official';

const PLUGIN_SCOPES = ['user', 'project', 'local'] as const;
export type PluginScope = (typeof PLUGIN_SCOPES)[number];

export interface InstalledPlugin {
  readonly id: string;
  readonly version: string;
  readonly scope: PluginScope;
  readonly enabled: boolean;
  readonly installPath: string;
}

function isPluginScope(value: unknown): value is PluginScope {
  return PLUGIN_SCOPES.some((scope) => scope === value);
}

function parsePlugin(entry: unknown, index: number): InstalledPlugin {
  if (!isRecord(entry)) {
    throw new TypeError(`Plugin #${index} is not an object.`);
  }
  const { id, version, scope, enabled, installPath } = entry;
  if (
    typeof id !== 'string' ||
    typeof version !== 'string' ||
    typeof enabled !== 'boolean' ||
    typeof installPath !== 'string' ||
    !isPluginScope(scope)
  ) {
    throw new TypeError(`Plugin #${index} does not have the expected shape.`);
  }
  return { id, version, scope, enabled, installPath };
}

/** Parses the output of `claude plugin list --json`. */
export function parsePluginList(json: string): InstalledPlugin[] {
  const data: unknown = JSON.parse(json);
  if (!Array.isArray(data)) {
    throw new TypeError('Expected `claude plugin list --json` to return an array.');
  }
  return data.map((entry, index) => parsePlugin(entry, index));
}

/** Skill names that appear in more than one plugin, sorted. */
export function findOverlappingSkills(
  skillsByPlugin: Readonly<Record<string, readonly string[]>>,
): string[] {
  const owners = new Map<string, number>();
  for (const skills of Object.values(skillsByPlugin)) {
    for (const skill of new Set(skills)) {
      owners.set(skill, (owners.get(skill) ?? 0) + 1);
    }
  }
  return [...owners]
    .filter(([, count]) => count > 1)
    .map(([skill]) => skill)
    .sort();
}

function describePlugin(plugin: InstalledPlugin): string {
  return `v${plugin.version}, ${plugin.enabled ? 'enabled' : 'disabled'}, ${plugin.scope} scope`;
}

function checkApimatic(plugin: InstalledPlugin | undefined): CheckResult {
  const title = 'APIMatic Context Plugin';
  if (plugin === undefined) {
    return result(
      'plugin-apimatic',
      title,
      'fail',
      `${APIMATIC_PLUGIN_ID} is not installed`,
      'claude plugin install paypal@context-plugins --scope project',
    );
  }
  return plugin.enabled
    ? result('plugin-apimatic', title, 'pass', `${APIMATIC_PLUGIN_ID} ${describePlugin(plugin)}`)
    : result(
        'plugin-apimatic',
        title,
        'warn',
        `${APIMATIC_PLUGIN_ID} is installed but disabled`,
        `claude plugin enable ${APIMATIC_PLUGIN_ID} --scope ${plugin.scope}`,
      );
}

function checkToolkit(plugin: InstalledPlugin | undefined, tokenPresent: boolean): CheckResult {
  const title = 'PayPal AI Toolkit';
  if (plugin === undefined) {
    return result(
      'plugin-paypal-toolkit',
      title,
      'warn',
      `${PAYPAL_TOOLKIT_PLUGIN_ID} is not installed (optional)`,
      'claude plugin install paypal@claude-plugins-official --scope local && claude plugin disable paypal@claude-plugins-official --scope local',
    );
  }
  if (!plugin.enabled) {
    return result(
      'plugin-paypal-toolkit',
      title,
      'pass',
      `${PAYPAL_TOOLKIT_PLUGIN_ID} ${describePlugin(plugin)} (kept off to avoid a model call on every file edit)`,
    );
  }
  return tokenPresent
    ? result(
        'plugin-paypal-toolkit',
        title,
        'pass',
        `${PAYPAL_TOOLKIT_PLUGIN_ID} ${describePlugin(plugin)}`,
      )
    : result(
        'plugin-paypal-toolkit',
        title,
        'warn',
        `${PAYPAL_TOOLKIT_PLUGIN_ID} is enabled but PAYPAL_SANDBOX_ACCESS_TOKEN is not set, so its sandbox MCP server cannot authenticate`,
        'Create a sandbox token (see docs/development-with-ai.md) or run: claude plugin disable paypal@claude-plugins-official --scope local',
      );
}

function checkPluginIdentity(
  installed: readonly InstalledPlugin[],
  skillsByPlugin: Readonly<Record<string, readonly string[]>>,
): CheckResult {
  const title = 'Plugin name collisions';
  const idsByName = new Map<string, string[]>();
  for (const { id } of installed) {
    const name = id.replace(/@.*$/, '');
    idsByName.set(name, [...(idsByName.get(name) ?? []), id]);
  }
  const shared = [...idsByName].filter(([, ids]) => ids.length > 1);
  const overlaps = findOverlappingSkills(skillsByPlugin);

  if (overlaps.length > 0) {
    return result(
      'plugin-collisions',
      title,
      'warn',
      `skills defined by more than one plugin: ${overlaps.join(', ')}`,
      'Disable one of the plugins that defines them',
    );
  }
  if (shared.length === 0) {
    return result('plugin-collisions', title, 'pass', 'every installed plugin has a unique name');
  }
  const names = shared.map(([name, ids]) => `"${name}" (${ids.join(', ')})`).join('; ');
  return result(
    'plugin-collisions',
    title,
    'pass',
    `${names} share a name but have distinct IDs and no overlapping skills`,
  );
}

export interface PluginCheckOptions {
  /** Whether PAYPAL_SANDBOX_ACCESS_TOKEN is set. The value itself must never be passed in. */
  readonly sandboxTokenPresent: boolean;
  /** Skill names shipped by each installed plugin, keyed by plugin id. */
  readonly skillsByPlugin: Readonly<Record<string, readonly string[]>>;
}

export function checkPlugins(
  installed: readonly InstalledPlugin[],
  options: PluginCheckOptions,
): CheckResult[] {
  const byId = new Map(installed.map((plugin) => [plugin.id, plugin]));
  return [
    checkApimatic(byId.get(APIMATIC_PLUGIN_ID)),
    checkToolkit(byId.get(PAYPAL_TOOLKIT_PLUGIN_ID), options.sandboxTokenPresent),
    checkPluginIdentity(installed, options.skillsByPlugin),
  ];
}

// ---------------------------------------------------------------------------------------
// Third-party skills (restored from skills-lock.json, never committed)
// ---------------------------------------------------------------------------------------

export interface SkillsLockEntry {
  readonly source: string;
  readonly sourceType: string;
  readonly skillPath: string;
  readonly computedHash: string;
}

export interface SkillsLock {
  readonly version: number;
  readonly skills: Readonly<Record<string, SkillsLockEntry>>;
}

const SOURCE_PATTERN = /^[\w.-]+\/[\w.-]+$/;
const HASH_PATTERN = /^[0-9a-f]{64}$/;

function parseLockEntry(name: string, value: unknown): SkillsLockEntry {
  if (!isRecord(value)) {
    throw new TypeError(`Skill "${name}" is not an object.`);
  }
  const { source, sourceType, skillPath, computedHash } = value;
  if (
    typeof source !== 'string' ||
    !SOURCE_PATTERN.test(source) ||
    typeof sourceType !== 'string' ||
    typeof skillPath !== 'string' ||
    typeof computedHash !== 'string' ||
    !HASH_PATTERN.test(computedHash)
  ) {
    throw new TypeError(`Skill "${name}" has an invalid source, path or hash.`);
  }
  return { source, sourceType, skillPath, computedHash };
}

/** Parses and validates `skills-lock.json`. */
export function parseSkillsLock(json: string): SkillsLock {
  const data: unknown = JSON.parse(json);
  if (!isRecord(data) || data['version'] !== 1 || !isRecord(data['skills'])) {
    throw new TypeError('skills-lock.json must be an object with version 1 and a "skills" map.');
  }
  const skills = Object.fromEntries(
    Object.entries(data['skills']).map(([name, entry]) => [name, parseLockEntry(name, entry)]),
  );
  return { version: 1, skills };
}

/** Skill names grouped by their source repository; both levels are sorted. */
export function groupSkillsBySource(lock: SkillsLock): ReadonlyMap<string, readonly string[]> {
  const groups = new Map<string, string[]>();
  for (const [name, entry] of Object.entries(lock.skills)) {
    groups.set(entry.source, [...(groups.get(entry.source) ?? []), name]);
  }
  return new Map(
    [...groups]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([source, names]) => [source, names.sort()]),
  );
}

/** A file inside a skill folder. */
export interface SkillFile {
  /** Path relative to the skill folder, with forward slashes. */
  readonly relativePath: string;
  readonly content: Uint8Array;
}

/**
 * The content hash the `skills` installer records in `skills-lock.json`: SHA-256 over each
 * file's relative path followed by its bytes, with files ordered by `localeCompare` of the
 * path. The ordering has to match the installer's, or the same folder hashes differently.
 */
export function hashSkillFiles(files: readonly SkillFile[]): string {
  const hash = createHash('sha256');
  for (const file of [...files].sort((a, b) => a.relativePath.localeCompare(b.relativePath))) {
    hash.update(file.relativePath);
    hash.update(file.content);
  }
  return hash.digest('hex');
}

/** Installed skills whose content differs from the lock file, sorted. Missing skills are not listed. */
export function findChangedSkills(
  lock: SkillsLock,
  installed: ReadonlyMap<string, string>,
): string[] {
  return Object.entries(lock.skills)
    .filter(([name, { computedHash }]) => {
      const hash = installed.get(name);
      return hash !== undefined && hash !== computedHash;
    })
    .map(([name]) => name)
    .sort();
}

/** `installed` maps each skill folder found in `.claude/skills` to its content hash. */
export function checkSkills(lock: SkillsLock, installed: ReadonlyMap<string, string>): CheckResult {
  const title = 'Sponsor skills';
  const expected = Object.keys(lock.skills).sort();
  const missing = expected.filter((name) => !installed.has(name));
  const changed = findChangedSkills(lock, installed);

  if (missing.length === 0 && changed.length === 0) {
    return result(
      'skills',
      title,
      'pass',
      `${expected.length} of ${expected.length} installed, content matches skills-lock.json`,
    );
  }

  const problems = [
    ...(missing.length > 0 ? [`missing: ${missing.join(', ')}`] : []),
    ...(changed.length > 0 ? [`content differs from the lock: ${changed.join(', ')}`] : []),
  ];
  return result(
    'skills',
    title,
    'fail',
    `${expected.length - missing.length} of ${expected.length} installed; ${problems.join('; ')}`,
    changed.length > 0
      ? 'pnpm dev:skills --force (if it still differs, review git diff skills-lock.json)'
      : 'pnpm dev:skills',
  );
}

// ---------------------------------------------------------------------------------------
// Optional binaries
// ---------------------------------------------------------------------------------------

export interface BinarySpec {
  readonly name: string;
  readonly title: string;
  readonly purpose: string;
  readonly install: string;
}

export const DEV_BINARIES: readonly BinarySpec[] = [
  {
    name: 'docker',
    title: 'Docker',
    purpose: 'local Postgres for database tests',
    install: 'Install Docker Desktop: https://docs.docker.com/desktop/',
  },
  {
    name: 'gitleaks',
    title: 'gitleaks',
    purpose: 'local secret scan in the pre-commit hook',
    install: 'brew install gitleaks',
  },
  {
    name: 'render',
    title: 'Render CLI',
    purpose: 'Workflows local task server and deploys',
    install: 'brew install render',
  },
];

/** `found` maps each binary that exists on PATH to its version string. */
export function checkBinaries(found: ReadonlyMap<string, string>): CheckResult[] {
  return DEV_BINARIES.map((binary) => {
    const version = found.get(binary.name);
    return version === undefined
      ? result(
          `binary-${binary.name}`,
          binary.title,
          'warn',
          `not installed (${binary.purpose})`,
          binary.install,
        )
      : result(`binary-${binary.name}`, binary.title, 'pass', version);
  });
}

// ---------------------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------------------

export interface Summary {
  readonly passed: number;
  readonly warnings: number;
  readonly failures: number;
}

export function summarize(results: readonly CheckResult[]): Summary {
  const count = (status: CheckStatus): number =>
    results.filter((entry) => entry.status === status).length;
  return { passed: count('pass'), warnings: count('warn'), failures: count('fail') };
}

/** Process exit code: failures always fail; warnings fail only in strict mode. */
export function exitCodeFor(results: readonly CheckResult[], strict: boolean): 0 | 1 {
  const { warnings, failures } = summarize(results);
  return failures > 0 || (strict && warnings > 0) ? 1 : 0;
}

const SYMBOLS: Readonly<Record<CheckStatus, string>> = { pass: '✓', warn: '!', fail: '✗' };

export function renderReport(results: readonly CheckResult[]): string {
  const lines = ['Bursar developer tooling', ''];
  for (const entry of results) {
    lines.push(`  ${SYMBOLS[entry.status]} ${entry.title}: ${entry.detail}`);
    if (entry.status !== 'pass' && entry.fix !== undefined) {
      lines.push(`      fix: ${entry.fix}`);
    }
  }
  const { passed, warnings, failures } = summarize(results);
  lines.push('', `${passed} passed, ${warnings} warning(s), ${failures} failed`);
  return lines.join('\n');
}
