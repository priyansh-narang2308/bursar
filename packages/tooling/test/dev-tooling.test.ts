import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  APIMATIC_PLUGIN_ID,
  type CheckResult,
  checkBinaries,
  checkClaudeCli,
  checkNode,
  checkPlugins,
  checkPnpm,
  checkSkills,
  DEV_BINARIES,
  exitCodeFor,
  findOverlappingSkills,
  groupSkillsBySource,
  type InstalledPlugin,
  PAYPAL_TOOLKIT_PLUGIN_ID,
  parsePluginList,
  parseRootManifest,
  parseSkillsLock,
  renderReport,
  summarize,
  supportedNodeMajors,
} from '../src/dev-tooling';

const HASH = 'a'.repeat(64);

const apimatic = (overrides: Partial<InstalledPlugin> = {}): InstalledPlugin => ({
  id: APIMATIC_PLUGIN_ID,
  version: '0.3.3',
  scope: 'project',
  enabled: true,
  installPath: '/cache/context-plugins/paypal',
  ...overrides,
});

const toolkit = (overrides: Partial<InstalledPlugin> = {}): InstalledPlugin => ({
  id: PAYPAL_TOOLKIT_PLUGIN_ID,
  version: '1.1.0',
  scope: 'local',
  enabled: false,
  installPath: '/cache/claude-plugins-official/paypal',
  ...overrides,
});

const noToken = { sandboxTokenPresent: false, skillsByPlugin: {} } as const;

const statusOf = (results: readonly CheckResult[], id: string): CheckResult | undefined =>
  results.find((entry) => entry.id === id);

describe('Node.js', () => {
  it('extracts the supported majors from an engines range', () => {
    expect(supportedNodeMajors('^24.0.0 || ^26.0.0')).toEqual([24, 26]);
    expect(supportedNodeMajors('>=20')).toEqual([]);
  });

  it.each(['v24.21.0', 'v26.5.0', '24.0.0'])('accepts %s', (version) => {
    expect(checkNode(version, '^24.0.0 || ^26.0.0').status).toBe('pass');
  });

  it.each(['v22.23.2', 'v25.1.0', 'banana'])('rejects %s with an install hint', (version) => {
    const check = checkNode(version, '^24.0.0 || ^26.0.0');
    expect(check.status).toBe('fail');
    expect(check.fix).toContain('nvm install');
  });
});

describe('root manifest', () => {
  it('reads the Node range and the pnpm pin', () => {
    expect(
      parseRootManifest(
        JSON.stringify({ engines: { node: '^24.0.0 || ^26.0.0' }, packageManager: 'pnpm@11.8.0' }),
      ),
    ).toEqual({ nodeRange: '^24.0.0 || ^26.0.0', packageManager: 'pnpm@11.8.0' });
  });

  it.each([
    ['no engines', JSON.stringify({ packageManager: 'pnpm@11.8.0' })],
    ['no packageManager', JSON.stringify({ engines: { node: '^24.0.0' } })],
    [
      'a non-string range',
      JSON.stringify({ engines: { node: 24 }, packageManager: 'pnpm@11.8.0' }),
    ],
    ['a non-object document', '[]'],
  ])('rejects %s', (_label, json) => {
    expect(() => parseRootManifest(json)).toThrow(TypeError);
  });
});

describe('pnpm', () => {
  it('passes when the running version equals the pin', () => {
    const check = checkPnpm('11.8.0', 'pnpm@11.8.0');
    expect(check.status).toBe('pass');
    expect(check.detail).toContain('pinned');
  });

  it('warns on a different version and says how to align', () => {
    const check = checkPnpm('11.9.1', 'pnpm@11.8.0');
    expect(check.status).toBe('warn');
    expect(check.detail).toContain('switches to the pinned version');
    expect(check.fix).toBe('pnpm self-update 11.8.0');
  });

  it('warns when packageManager is not an exact pnpm version', () => {
    const check = checkPnpm('11.8.0', 'pnpm@^11');
    expect(check.status).toBe('warn');
    expect(check.fix).toContain('pnpm@11.8.0');
  });

  it('fails when pnpm is not installed', () => {
    const check = checkPnpm(undefined, 'pnpm@11.8.0');
    expect(check.status).toBe('fail');
    expect(check.fix).toContain('pnpm.io');
  });
});

describe('Claude Code CLI', () => {
  it('passes and echoes the version', () => {
    expect(checkClaudeCli('2.1.286 (Claude Code)')).toMatchObject({
      status: 'pass',
      detail: '2.1.286 (Claude Code)',
    });
  });

  it('fails with an install pointer when the CLI is missing', () => {
    const check = checkClaudeCli(undefined);
    expect(check.status).toBe('fail');
    expect(check.fix).toContain('claude.com');
  });
});

describe('parsePluginList', () => {
  const realOutput = JSON.stringify([
    {
      id: 'paypal@claude-plugins-official',
      version: '1.1.0',
      scope: 'local',
      enabled: false,
      installPath: '/cache/toolkit',
      installedAt: '2026-10-05T09:21:03.183Z',
      projectPath: '/work/bursar',
      mcpServers: { 'paypal-sandbox': { type: 'sse', url: 'https://mcp.sandbox.paypal.com/sse' } },
      projectEnabled: false,
    },
    {
      id: 'paypal@context-plugins',
      version: '0.3.3',
      scope: 'project',
      enabled: true,
      installPath: '/cache/apimatic',
      projectEnabled: true,
    },
  ]);

  it('keeps only the fields it needs from the real CLI output', () => {
    expect(parsePluginList(realOutput)).toEqual([
      toolkit({ installPath: '/cache/toolkit' }),
      apimatic({ installPath: '/cache/apimatic' }),
    ]);
  });

  it('accepts an empty list', () => {
    expect(parsePluginList('[]')).toEqual([]);
  });

  it.each([
    ['an object instead of an array', '{}', /array/],
    ['a non-object entry', '[1]', /not an object/],
    ['a missing field', '[{"id":"a@b"}]', /expected shape/],
    [
      'an unknown scope',
      '[{"id":"a@b","version":"1","scope":"global","enabled":true,"installPath":"/x"}]',
      /expected shape/,
    ],
    [
      'a non-boolean enabled flag',
      '[{"id":"a@b","version":"1","scope":"user","enabled":"yes","installPath":"/x"}]',
      /expected shape/,
    ],
  ])('rejects %s', (_label, json, message) => {
    expect(() => parsePluginList(json)).toThrow(message);
  });

  it('propagates invalid JSON as a SyntaxError', () => {
    expect(() => parsePluginList('not json')).toThrow(SyntaxError);
  });
});

describe('checkPlugins', () => {
  it('passes when APIMatic is enabled and the toolkit is installed but off', () => {
    const results = checkPlugins([apimatic(), toolkit()], noToken);

    expect(statusOf(results, 'plugin-apimatic')?.status).toBe('pass');
    expect(statusOf(results, 'plugin-apimatic')?.detail).toContain(
      'v0.3.3, enabled, project scope',
    );
    expect(statusOf(results, 'plugin-paypal-toolkit')?.status).toBe('pass');
    expect(statusOf(results, 'plugin-paypal-toolkit')?.detail).toContain('disabled');
  });

  it('fails when the APIMatic plugin is missing and names the project-scope install', () => {
    const check = statusOf(checkPlugins([toolkit()], noToken), 'plugin-apimatic');

    expect(check?.status).toBe('fail');
    expect(check?.fix).toBe('claude plugin install paypal@context-plugins --scope project');
  });

  it('warns when the APIMatic plugin is disabled and re-enables in the same scope', () => {
    const check = statusOf(
      checkPlugins([apimatic({ enabled: false, scope: 'local' })], noToken),
      'plugin-apimatic',
    );

    expect(check?.status).toBe('warn');
    expect(check?.fix).toBe(`claude plugin enable ${APIMATIC_PLUGIN_ID} --scope local`);
  });

  it('only warns when the optional PayPal toolkit is missing', () => {
    const check = statusOf(checkPlugins([apimatic()], noToken), 'plugin-paypal-toolkit');

    expect(check?.status).toBe('warn');
    expect(check?.detail).toContain('optional');
  });

  it('warns when the toolkit is enabled without a sandbox token', () => {
    const check = statusOf(
      checkPlugins([apimatic(), toolkit({ enabled: true })], noToken),
      'plugin-paypal-toolkit',
    );

    expect(check?.status).toBe('warn');
    expect(check?.detail).toContain('PAYPAL_SANDBOX_ACCESS_TOKEN');
  });

  it('passes when the toolkit is enabled and a token is present', () => {
    const check = statusOf(
      checkPlugins([apimatic(), toolkit({ enabled: true })], {
        sandboxTokenPresent: true,
        skillsByPlugin: {},
      }),
      'plugin-paypal-toolkit',
    );

    expect(check?.status).toBe('pass');
  });

  it('treats a shared short name with distinct IDs and no shared skills as fine', () => {
    const check = statusOf(
      checkPlugins([apimatic(), toolkit()], {
        sandboxTokenPresent: false,
        skillsByPlugin: {
          [APIMATIC_PLUGIN_ID]: ['typescript-models'],
          [PAYPAL_TOOLKIT_PLUGIN_ID]: ['doctor'],
        },
      }),
      'plugin-collisions',
    );

    expect(check?.status).toBe('pass');
    expect(check?.detail).toContain('"paypal"');
    expect(check?.detail).toContain('distinct IDs');
  });

  it('warns when two plugins define the same skill', () => {
    const check = statusOf(
      checkPlugins([apimatic(), toolkit()], {
        sandboxTokenPresent: false,
        skillsByPlugin: {
          [APIMATIC_PLUGIN_ID]: ['setup', 'typescript-models'],
          [PAYPAL_TOOLKIT_PLUGIN_ID]: ['setup'],
        },
      }),
      'plugin-collisions',
    );

    expect(check?.status).toBe('warn');
    expect(check?.detail).toContain('setup');
  });

  it('passes when every plugin name is unique', () => {
    const check = statusOf(checkPlugins([apimatic()], noToken), 'plugin-collisions');

    expect(check?.status).toBe('pass');
    expect(check?.detail).toContain('unique');
  });
});

describe('findOverlappingSkills', () => {
  it('returns skills present in more than one plugin, sorted', () => {
    expect(findOverlappingSkills({ a: ['x', 'y', 'z'], b: ['z', 'y'], c: ['q'] })).toEqual([
      'y',
      'z',
    ]);
  });

  it('does not count a duplicate inside a single plugin', () => {
    expect(findOverlappingSkills({ a: ['x', 'x'], b: ['y'] })).toEqual([]);
  });

  it('matches a reference implementation on arbitrary input', () => {
    fc.assert(
      fc.property(
        fc.dictionary(
          fc.string({ minLength: 1, maxLength: 3 }),
          fc.array(fc.string({ minLength: 1, maxLength: 2 }), { maxLength: 6 }),
        ),
        (skillsByPlugin) => {
          const seen = new Set<string>();
          const overlapping = new Set<string>();
          for (const skills of Object.values(skillsByPlugin)) {
            for (const skill of new Set(skills)) {
              if (seen.has(skill)) {
                overlapping.add(skill);
              } else {
                seen.add(skill);
              }
            }
          }
          expect(findOverlappingSkills(skillsByPlugin)).toEqual([...overlapping].sort());
        },
      ),
    );
  });
});

describe('skills lock', () => {
  const entry = (source: string, name: string) => ({
    source,
    sourceType: 'github',
    skillPath: `skills/${name}/SKILL.md`,
    computedHash: HASH,
  });
  const lockJson = JSON.stringify({
    version: 1,
    skills: {
      'render-cli': entry('render-oss/skills', 'render-cli'),
      'ag-dev': entry('ag-grid/skills', 'ag-dev'),
      'render-blueprints': entry('render-oss/skills', 'render-blueprints'),
    },
  });

  it('parses a valid lock file', () => {
    const lock = parseSkillsLock(lockJson);
    expect(lock.version).toBe(1);
    expect(Object.keys(lock.skills).sort()).toEqual(['ag-dev', 'render-blueprints', 'render-cli']);
  });

  it.each([
    ['a different version', JSON.stringify({ version: 2, skills: {} })],
    ['a missing skills map', JSON.stringify({ version: 1 })],
    ['a non-object document', '[]'],
    ['a non-object entry', JSON.stringify({ version: 1, skills: { a: 'nope' } })],
    [
      'a source that is not owner/repo',
      JSON.stringify({ version: 1, skills: { a: { ...entry('nonsense', 'a') } } }),
    ],
    [
      'a hash that is not 64 hex characters',
      JSON.stringify({
        version: 1,
        skills: { a: { ...entry('o/r', 'a'), computedHash: 'abc' } },
      }),
    ],
    [
      'a missing path',
      JSON.stringify({
        version: 1,
        skills: { a: { source: 'o/r', sourceType: 'github', computedHash: HASH } },
      }),
    ],
  ])('rejects %s', (_label, json) => {
    expect(() => parseSkillsLock(json)).toThrow(TypeError);
  });

  it('groups skills by source with both levels sorted', () => {
    const groups = groupSkillsBySource(parseSkillsLock(lockJson));

    expect([...groups]).toEqual([
      ['ag-grid/skills', ['ag-dev']],
      ['render-oss/skills', ['render-blueprints', 'render-cli']],
    ]);
  });

  it('never loses or duplicates a skill when grouping', () => {
    fc.assert(
      fc.property(
        fc.dictionary(
          fc.stringMatching(/^[a-z][a-z0-9-]{0,8}$/),
          fc.constantFrom('a/one', 'b/two', 'c/three'),
        ),
        (sourceByName) => {
          const skills = Object.fromEntries(
            Object.entries(sourceByName).map(([name, source]) => [name, entry(source, name)]),
          );
          const grouped = [...groupSkillsBySource({ version: 1, skills }).values()].flat();

          expect([...grouped].sort()).toEqual(Object.keys(skills).sort());
        },
      ),
    );
  });

  it('passes when every locked skill is installed, ignoring extras', () => {
    const lock = parseSkillsLock(lockJson);
    const check = checkSkills(
      lock,
      new Set(['ag-dev', 'render-cli', 'render-blueprints', 'extra']),
    );

    expect(check.status).toBe('pass');
    expect(check.detail).toBe('3 of 3 installed in .claude/skills');
  });

  it('fails and lists what is missing, pointing at the installer script', () => {
    const check = checkSkills(parseSkillsLock(lockJson), new Set(['ag-dev']));

    expect(check.status).toBe('fail');
    expect(check.detail).toBe('1 of 3 installed; missing: render-blueprints, render-cli');
    expect(check.fix).toBe('pnpm dev:skills');
  });
});

describe('checkBinaries', () => {
  it('passes with the reported version for binaries that exist', () => {
    const found = new Map(DEV_BINARIES.map((binary) => [binary.name, `${binary.name} 1.0.0`]));

    for (const check of checkBinaries(found)) {
      expect(check.status).toBe('pass');
      expect(check.detail).toMatch(/ 1\.0\.0$/);
    }
  });

  it('warns with an install hint for each missing binary', () => {
    const checks = checkBinaries(new Map([['docker', 'Docker 28.0']]));

    expect(checks.map((check) => check.status)).toEqual(['pass', 'warn', 'warn']);
    expect(checks.find((check) => check.id === 'binary-render')?.fix).toBe('brew install render');
    expect(checks.find((check) => check.id === 'binary-gitleaks')?.fix).toBe(
      'brew install gitleaks',
    );
  });

  it('lists each binary exactly once', () => {
    const names = DEV_BINARIES.map((binary) => binary.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe('reporting', () => {
  const pass: CheckResult = { id: 'a', title: 'Alpha', status: 'pass', detail: 'fine' };
  const warn: CheckResult = { id: 'b', title: 'Beta', status: 'warn', detail: 'hmm', fix: 'do x' };
  const fail: CheckResult = {
    id: 'c',
    title: 'Gamma',
    status: 'fail',
    detail: 'broken',
    fix: 'do y',
  };

  it('counts each status', () => {
    expect(summarize([pass, pass, warn, fail])).toEqual({ passed: 2, warnings: 1, failures: 1 });
  });

  it.each([
    ['only passes', [pass], false, 0],
    ['only passes in strict mode', [pass], true, 0],
    ['a warning', [pass, warn], false, 0],
    ['a warning in strict mode', [pass, warn], true, 1],
    ['a failure', [pass, fail], false, 1],
    ['nothing at all', [], true, 0],
  ] as const)('exits with the right code for %s', (_label, results, strict, expected) => {
    expect(exitCodeFor(results, strict)).toBe(expected);
  });

  it('renders symbols, fixes for non-passing checks only, and a summary', () => {
    expect(renderReport([pass, warn, fail])).toBe(
      [
        'Bursar developer tooling',
        '',
        '  ✓ Alpha: fine',
        '  ! Beta: hmm',
        '      fix: do x',
        '  ✗ Gamma: broken',
        '      fix: do y',
        '',
        '1 passed, 1 warning(s), 1 failed',
      ].join('\n'),
    );
  });

  it('omits the fix line when a failing check has none', () => {
    const bare: CheckResult = { id: 'd', title: 'Delta', status: 'fail', detail: 'bad' };
    expect(renderReport([bare])).not.toContain('fix:');
  });
});
