import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { APIMATIC_PLUGIN_ID, PAYPAL_TOOLKIT_PLUGIN_ID, parseSkillsLock } from '../src/dev-tooling';

/**
 * These tests turn repository conventions into executable checks, so the standards that
 * keep the codebase clean cannot silently drift as it grows.
 */

interface PackageJson {
  name?: string;
  private?: boolean;
  type?: string;
  license?: string;
  packageManager?: string;
  engines?: Record<string, string>;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
}

const root = fileURLToPath(new URL('../../../', import.meta.url));
const read = (path: string): string => readFileSync(join(root, path), 'utf8');
const readPackageJson = (dir: string): PackageJson => JSON.parse(read(join(dir, 'package.json')));
const gitignoreRules = read('.gitignore')
  .split('\n')
  .map((line) => line.trim());

const workspaceDirs = ['apps', 'packages'].flatMap((group) =>
  readdirSync(join(root, group), { withFileTypes: true })
    .filter(
      (entry) => entry.isDirectory() && existsSync(join(root, group, entry.name, 'package.json')),
    )
    .map((entry) => `${group}/${entry.name}`),
);

describe('runtime pinning', () => {
  it('pins the oldest supported Node major in .nvmrc', () => {
    const nvmrc = read('.nvmrc').trim();
    expect(nvmrc).toMatch(/^\d+(?:\.\d+){0,2}$/);

    const range = readPackageJson('.').engines?.['node'] ?? '';
    const supportedMajors = [...range.matchAll(/\^(\d+)\./g)].map((match) => Number(match[1]));
    expect(supportedMajors.length).toBeGreaterThan(0);
    expect(Number(nvmrc.split('.')[0])).toBe(Math.min(...supportedMajors));
  });

  it('pins pnpm exactly and requires at least its major version', () => {
    const manifest = readPackageJson('.');
    const pinned = /^pnpm@(\d+)\.\d+\.\d+$/.exec(manifest.packageManager ?? '');
    const required = /^>=(\d+)$/.exec(manifest.engines?.['pnpm'] ?? '');

    expect(pinned).not.toBeNull();
    expect(required).not.toBeNull();
    expect(Number(required?.[1])).toBeLessThanOrEqual(Number(pinned?.[1]));
  });
});

describe('workspace packages', () => {
  it('discovers the shared tooling package', () => {
    expect(workspaceDirs).toContain('packages/tooling');
  });

  it.each(workspaceDirs)('%s follows the package conventions', (dir) => {
    const manifest = readPackageJson(dir);

    expect(manifest.name).toMatch(/^@bursar\/[a-z0-9-]+$/);
    expect(manifest.private).toBe(true);
    expect(manifest.type).toBe('module');
    expect(manifest.license).toBe('Apache-2.0');
    expect(manifest.scripts).toHaveProperty('typecheck');
    expect(manifest.scripts).toHaveProperty('test');

    const tsconfig: { extends?: string } = JSON.parse(read(join(dir, 'tsconfig.json')));
    expect(tsconfig.extends).toMatch(/tsconfig\.base\.json$/);
  });

  it('keeps the root tsconfig on the strict base', () => {
    const tsconfig: { extends?: string } = JSON.parse(read('tsconfig.json'));
    expect(tsconfig.extends).toBe('./tsconfig.base.json');
  });
});

describe('dependency specifiers', () => {
  const allowed = /^(?:catalog:[\w-]*|workspace:[*^~]?|[\^~]?\d+\.\d+\.\d+(?:-[\w.]+)?)$/;

  it('use only catalog, workspace or pinned-semver specifiers', () => {
    const offenders = ['.', ...workspaceDirs].flatMap((dir) => {
      const manifest = readPackageJson(dir);
      const sections = [
        manifest.dependencies,
        manifest.devDependencies,
        manifest.peerDependencies,
        manifest.optionalDependencies,
      ];
      return sections
        .flatMap((section) => Object.entries(section ?? {}))
        .filter(([, specifier]) => !allowed.test(specifier))
        .map(([name, specifier]) => `${dir}: ${name}@${specifier}`);
    });

    expect(offenders).toEqual([]);
  });
});

describe('.env.example', () => {
  const entries = read('.env.example')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'))
    .map((line) => {
      const separator = line.indexOf('=');
      return { line, key: line.slice(0, separator), value: line.slice(separator + 1) };
    });

  const envValue = (key: string): string | undefined =>
    entries.find((entry) => entry.key === key)?.value;

  it('only declares KEY=value pairs', () => {
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.filter(({ line }) => !/^[A-Z][A-Z0-9_]*=/.test(line))).toEqual([]);
  });

  it('leaves every secret-like variable empty', () => {
    const filled = entries.filter(
      ({ key, value }) => /SECRET|TOKEN|PASSWORD|KEY|LICENSE/.test(key) && value !== '',
    );
    expect(filled.map(({ key }) => key)).toEqual([]);
  });

  it('contains nothing that looks like a real credential', () => {
    const suspicious = entries.filter(({ value }) =>
      /[0-9a-f]{32,}|A21AA[\w-]{20,}|sk-[A-Za-z0-9_-]{20,}/i.test(value),
    );
    expect(suspicious.map(({ key }) => key)).toEqual([]);
  });

  it('only embeds credentials in loopback URLs', () => {
    const withCredentials = /[a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:[^\s/@]+@([^\s/:]+)/i;
    const hosts = entries.flatMap(({ value }) => withCredentials.exec(value)?.[1] ?? []);
    expect(hosts.every((host) => host === 'localhost' || host === '127.0.0.1')).toBe(true);
  });

  it('is sandbox-only by default', () => {
    expect(envValue('PAYPAL_ENV')).toBe('sandbox');
    expect(envValue('ALLOW_LIVE')).toBe('false');
  });
});

describe('repository hygiene', () => {
  it('ships the Apache-2.0 license', () => {
    const license = read('LICENSE');
    expect(license).toContain('Apache License');
    expect(license).toContain('Version 2.0, January 2004');
  });

  it('never commits local environment files', () => {
    expect(gitignoreRules).toEqual(expect.arrayContaining(['.env', '.env.*', '!.env.example']));
  });
});

describe('architecture decision records', () => {
  const decisions = readdirSync(join(root, 'docs', 'decisions'))
    .filter((file) => file !== 'README.md')
    .sort();
  const index = read('docs/decisions/README.md');

  it('are named NNNN-kebab-case.md and numbered consecutively from 0001', () => {
    expect(decisions.length).toBeGreaterThan(0);
    expect(decisions.filter((file) => !/^\d{4}-[a-z0-9]+(?:-[a-z0-9]+)*\.md$/.test(file))).toEqual(
      [],
    );
    expect(decisions.map((file) => file.slice(0, 4))).toEqual(
      decisions.map((_, position) => String(position + 1).padStart(4, '0')),
    );
  });

  it.each(decisions)('%s has a status, a date and an entry in the index', (file) => {
    const text = read(join('docs', 'decisions', file));
    expect(text).toMatch(/^# ADR-\d{4}: \S/m);
    expect(text).toMatch(/^- \*\*Status:\*\* (?:Proposed|Accepted|Superseded by ADR-\d{4})$/m);
    expect(text).toMatch(/^- \*\*Date:\*\* \d{4}-\d{2}-\d{2}$/m);
    expect(index).toContain(`(${file})`);
  });
});

describe('Claude Code project settings', () => {
  interface ProjectSettings {
    extraKnownMarketplaces?: Record<string, { source?: { source?: string; repo?: string } }>;
    enabledPlugins?: Record<string, boolean>;
  }
  const settings: ProjectSettings = JSON.parse(read('.claude/settings.json'));

  it('only declares marketplaces and plugins, so it cannot run code or carry secrets', () => {
    // Hooks, env values, permissions, MCP servers and helper commands would take effect on every
    // contributor's machine. Personal choices belong in the git-ignored settings.local.json.
    const allowed = ['extraKnownMarketplaces', 'enabledPlugins'];
    expect(Object.keys(settings).filter((key) => !allowed.includes(key))).toEqual([]);
  });

  it('trusts only marketplaces hosted on GitHub', () => {
    const sources = Object.values(settings.extraKnownMarketplaces ?? {}).map(
      (marketplace) => marketplace.source,
    );
    expect(sources.length).toBeGreaterThan(0);
    for (const source of sources) {
      expect(source?.source).toBe('github');
      expect(source?.repo).toMatch(/^[\w.-]+\/[\w.-]+$/);
    }
  });

  it('enables the APIMatic plugin and only plugins from a declared marketplace', () => {
    const marketplaces = Object.keys(settings.extraKnownMarketplaces ?? {});
    const enabled = Object.entries(settings.enabledPlugins ?? {})
      .filter(([, on]) => on)
      .map(([id]) => id);

    expect(enabled).toContain(APIMATIC_PLUGIN_ID);
    expect(enabled.filter((id) => !marketplaces.includes(id.slice(id.indexOf('@') + 1)))).toEqual(
      [],
    );
  });

  it('keeps the PayPal AI Toolkit opt-in per developer', () => {
    // Its hook is a model call on every edit and its MCP server needs a token (see ADR-0002).
    expect(settings.enabledPlugins?.[PAYPAL_TOOLKIT_PLUGIN_ID]).not.toBe(true);
  });
});

describe('sponsor skills', () => {
  const approvedSources = ['ag-grid/skills', 'bryntum/skills', 'render-oss/skills'];
  const readLock = () => parseSkillsLock(read('skills-lock.json'));

  it('are pinned by content hash in a valid lock file', () => {
    expect(Object.keys(readLock().skills).length).toBeGreaterThan(0);
  });

  it('come only from the approved sponsor repositories on GitHub', () => {
    const entries = Object.values(readLock().skills);
    expect(entries.filter(({ sourceType }) => sourceType !== 'github')).toEqual([]);
    expect(entries.filter(({ source }) => !approvedSources.includes(source))).toEqual([]);
  });

  it('are restored locally rather than committed', () => {
    // One of the packs ships without a licence, so the files stay out of git (see ADR-0002).
    expect(gitignoreRules).toEqual(
      expect.arrayContaining(['.claude/skills/', '.claude/settings.local.json']),
    );
  });
});

describe('developer scripts', () => {
  const scripts = readPackageJson('.').scripts ?? {};

  it('run files that exist', () => {
    const targets = Object.values(scripts).flatMap((command) => {
      const target = /^tsx (\S+)/.exec(command)?.[1];
      return target === undefined ? [] : [target];
    });

    expect(targets).toEqual(
      expect.arrayContaining(['scripts/dev/verify-tooling.ts', 'scripts/dev/install-skills.ts']),
    );
    expect(targets.filter((target) => !existsSync(join(root, target)))).toEqual([]);
  });

  it('are all documented in AGENTS.md', () => {
    const documented = new Set(
      [...read('AGENTS.md').matchAll(/pnpm ([\w:-]+)/g)].map((match) => match[1]),
    );
    const undocumented = Object.keys(scripts).filter(
      (name) => name !== 'prepare' && !documented.has(name),
    );
    expect(undocumented).toEqual([]);
  });
});
