import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  FAMILIES,
  freeze,
  generate,
  invariants,
  judge,
  minimize,
  type PolicyConfig,
  play,
  proposePatches,
  rng,
  runLab,
  type Scenario,
  thaw,
} from '../src';
import { labWorld } from './support';

let lab: Awaited<ReturnType<typeof labWorld>>;
beforeAll(async () => {
  lab = await labWorld();
});
afterAll(() => lab.close());

// A trusted supplier, so a first order does not always wait for a person; everything else is standard.
const BASELINE: PolicyConfig = { without: ['R-NEW-VENDOR'], overrides: {} };
// The seeded hole: nothing limits what is approved in a day, so many orders under the dual-approval line add up.
const HOLE: PolicyConfig = { without: ['R-NEW-VENDOR', 'R-VELOCITY'], overrides: {} };
const RULES = invariants();
const REGRESSIONS = join(import.meta.dirname, '..', 'regressions');

describe('scenarios', () => {
  it('are the same for the same seed, and cover every family', async () => {
    const a = await generate({ seed: 7, count: 24 });
    expect(a).toEqual(await generate({ seed: 7, count: 24 }));
    expect(a).not.toEqual(await generate({ seed: 8, count: 24 }));
    expect(new Set(a.map((s) => s.family))).toEqual(new Set(FAMILIES));
    expect(a[10]?.steps).not.toEqual(
      (await generate({ seed: 7, count: 24, mutate: (s) => s }))[10]?.steps,
    ); // mutation reshapes
    const r = rng(1);
    expect(r.int(3, 3)).toBe(3);
  });
});

describe('finding, minimising, patching and freezing a hole', () => {
  // Two holes: the seeded one, and one the lab really found in the standard policy (velocity was per supplier).
  const CASES = [
    { name: 'structuring-under-dual-approval', family: 'structuring', hole: HOLE, minimum: 4 },
    {
      name: 'split-across-suppliers',
      family: 'split-suppliers',
      hole: {
        without: ['R-NEW-VENDOR'],
        overrides: { 'R-VELOCITY': { max: { currency: 'USD', minor: '300000' } } },
      } as PolicyConfig,
      minimum: 4,
    },
  ] as const;

  for (const c of CASES) {
    it(`${c.name}: finds it, shrinks it, patches it and freezes it`, async () => {
      const [scenario] = (await generate({ seed: 3, count: 1, families: [c.family] })) as [
        Scenario,
      ];
      const found = await judge(await lab.makeEnv(c.hole, scenario), scenario, RULES);
      expect(found.map((v) => v.invariant)).toContain('AUTO_SPEND_BOUNDED');
      const fails = async (s: Scenario) =>
        (await judge(await lab.makeEnv(c.hole, s), s, RULES)).some(
          (v) => v.invariant === 'AUTO_SPEND_BOUNDED',
        );
      const small = await minimize(scenario, fails);
      expect(small.steps.length).toBeLessThan(scenario.steps.length);
      expect(small.steps.length).toBeGreaterThanOrEqual(c.minimum); // under $1,000 an order cannot reach $3,000 in fewer
      // 1-minimal: take any step away and it no longer fails.
      for (let i = 0; i < small.steps.length; i++)
        expect(await fails({ ...small, steps: small.steps.filter((_, j) => j !== i) })).toBe(false);

      const [patch] = proposePatches(found[0] ?? { invariant: '', detail: '' }, c.hole);
      expect(patch?.description).toContain('R-VELOCITY');
      const fixed = patch?.apply(c.hole) as PolicyConfig;
      expect(await judge(await lab.makeEnv(fixed, small), small, RULES)).toEqual([]);

      const frozen = freeze({
        invariant: 'AUTO_SPEND_BOUNDED',
        scenario: small,
        before: c.hole,
        after: fixed,
        note: patch?.description ?? '',
      });
      const file = join(REGRESSIONS, `${c.name}.json`);
      if (!existsSync(file)) writeFileSync(file, frozen);
      expect(thaw(frozen).scenario.steps).toEqual(small.steps);
    });
  }

  it('has patches for each invariant, and none for one it does not know', () => {
    const v = (invariant: string) => ({ invariant, detail: '' });
    const bare: PolicyConfig = {
      without: ['R-ENVELOPE', 'R-DUPLICATE', 'R-ITEM-CAP', 'R-VELOCITY'],
      overrides: {},
    };
    for (const id of [
      'AUTO_SPEND_BOUNDED',
      'BUDGET_RESPECTED',
      'NO_DOUBLE_APPROVAL',
      'ITEM_CAP_HOLDS',
    ])
      expect(proposePatches(v(id), bare).length).toBeGreaterThan(0);
    expect(proposePatches(v('MYSTERY'), bare)).toEqual([]);
    expect(proposePatches(v('BUDGET_RESPECTED'), BASELINE)).toEqual([]);
  });
});

describe('the frozen regressions', () => {
  const files = readdirSync(REGRESSIONS).filter((f) => f.endsWith('.json'));
  it('exist', () => expect(files.length).toBeGreaterThan(0));
  for (const file of files) {
    it(`${file}: broke the old policy and holds under the fixed one`, async () => {
      const r = thaw(readFileSync(join(REGRESSIONS, file), 'utf8'));
      const before = await judge(await lab.makeEnv(r.before, r.scenario), r.scenario, RULES);
      expect(before.map((v) => v.invariant)).toContain(r.invariant);
      expect(await judge(await lab.makeEnv(r.after, r.scenario), r.scenario, RULES)).toEqual([]);
    });
  }
});

describe('a full run', () => {
  it('plays 120 scenarios against the standard policy and reports what it finds', async () => {
    const scenarios = await generate({ seed: 2026, count: 120 });
    const report = await runLab((s) => lab.makeEnv(BASELINE, s), scenarios);
    expect(report.total).toBe(120);
    expect(Object.keys(report.byFamily).sort()).toEqual([...FAMILIES].sort());
    expect(
      report.findings.map((f) => `${f.scenario.family}:${f.violations.map((v) => v.invariant)}`),
    ).toEqual([]);
  });

  it('shows the hole in bulk: the same run against the holed policy finds it', async () => {
    const scenarios = await generate({
      seed: 2026,
      count: 16,
      families: ['structuring', 'slow-structuring'],
    });
    const report = await runLab((s) => lab.makeEnv(HOLE, s), scenarios);
    expect(report.findings.length).toBeGreaterThan(0);
    expect(await play(await lab.makeEnv(BASELINE), scenarios[0] as Scenario)).toHaveLength(
      (scenarios[0] as Scenario).steps.length,
    );
  });
});
