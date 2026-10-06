import { type Policy, standardPolicy } from '@bursar/policy';
import type { RuleId } from '@bursar/schemas';

/*
 * The Policy Lab hunts for holes in a policy the way an adversary would: it invents sequences of orders,
 * runs each against the real decision pipeline, and checks properties that must always hold. When one
 * breaks it shrinks the sequence to the smallest that still breaks it, suggests a change to the policy,
 * and freezes the case so the fix can never quietly regress.
 */

// ---------------------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------------------

export const FAMILIES = [
  'structuring',
  'slow-structuring',
  'split-suppliers',
  'duplicate-burst',
  'envelope-exhaust',
  'quantity-spike',
  'item-cap-edge',
  'big-first-order',
] as const;
export type Family = (typeof FAMILIES)[number];

export interface OrderStep {
  readonly supplier: string;
  readonly unitCents: number;
  readonly quantity: number;
  /** Minutes since the step before it. */
  readonly afterMinutes: number;
}

export interface Scenario {
  readonly id: string;
  readonly family: Family;
  /** What the mission may spend, in cents. */
  readonly budgetCents: number;
  readonly steps: readonly OrderStep[];
}

/** A small deterministic generator (mulberry32), so a seed always gives the same scenarios. */
export function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return { next, int: (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1)) };
}
type Rng = ReturnType<typeof rng>;

const order = (
  supplier: string,
  unitCents: number,
  quantity: number,
  afterMinutes: number,
): OrderStep => ({ supplier, unitCents, quantity, afterMinutes });
const repeat = (n: number, make: (i: number) => OrderStep): OrderStep[] =>
  Array.from({ length: n }, (_, i) => make(i));
const BIG_BUDGET = 5_000_000;

const TEMPLATES: Readonly<Record<Family, (r: Rng) => Omit<Scenario, 'id' | 'family'>>> = {
  // Each order just under the dual-approval line, one after another.
  structuring: (r) => ({
    budgetCents: BIG_BUDGET,
    steps: repeat(r.int(7, 10), (i) => order('A', 48_900 + i * 7, 1, r.int(5, 30))),
  }),
  // The same, spread across most of a day.
  'slow-structuring': (r) => ({
    budgetCents: BIG_BUDGET,
    steps: repeat(r.int(8, 10), (i) => order('A', 48_800 + i * 13, 1, r.int(100, 140))),
  }),
  // The same total, split across suppliers.
  'split-suppliers': (r) => ({
    budgetCents: BIG_BUDGET,
    steps: repeat(r.int(8, 10), (i) => order(`S${i % 5}`, 48_700 + i * 11, 1, r.int(5, 40))),
  }),
  'duplicate-burst': (r) => ({
    budgetCents: BIG_BUDGET,
    steps: repeat(r.int(3, 5), (i) => order('A', 30_000, 1, i === 0 ? 0 : r.int(1, 5))),
  }),
  'envelope-exhaust': (r) => ({
    budgetCents: 200_000,
    steps: repeat(r.int(7, 10), (i) => order('A', 45_000 + i, 1, r.int(2, 20))),
  }),
  'quantity-spike': (r) => ({
    budgetCents: BIG_BUDGET,
    steps: [
      order('A', r.int(200, 500), r.int(60, 99), 0),
      order('A', r.int(200, 500), r.int(60, 99), r.int(5, 60)),
    ],
  }),
  'item-cap-edge': (r) => ({
    budgetCents: BIG_BUDGET,
    steps: [49_999, 50_000, 50_001, 50_000 + r.int(2, 5_000)].map((u, i) =>
      order('A', u, 1, i === 0 ? 0 : r.int(2, 30)),
    ),
  }),
  'big-first-order': (r) => ({
    budgetCents: BIG_BUDGET,
    steps: [order('NEW', r.int(90_000, 99_999), 2, 0)],
  }),
};

/** Anything that reshapes a scenario, such as a model asked to be sneakier. The default is deterministic jitter. */
export type Mutator = (scenario: Scenario, r: Rng) => Scenario | Promise<Scenario>;

export const jitter: Mutator = (s, r) => ({
  ...s,
  steps: s.steps.map((st) => ({
    ...st,
    unitCents: Math.max(1, Math.round(st.unitCents * (0.97 + r.next() * 0.06))),
    afterMinutes: Math.max(0, Math.round(st.afterMinutes * (0.8 + r.next() * 0.4))),
  })),
});

/** `count` scenarios, round robin over the families, each reshaped by `mutate` after the first lap. */
export async function generate(options: {
  seed: number;
  count: number;
  families?: readonly Family[];
  mutate?: Mutator;
}): Promise<Scenario[]> {
  const r = rng(options.seed);
  const families = options.families ?? FAMILIES;
  const mutate = options.mutate ?? jitter;
  const out: Scenario[] = [];
  for (let i = 0; i < options.count; i++) {
    const family = families[i % families.length] as Family;
    const base: Scenario = {
      id: `${family}-${options.seed}-${i}`,
      family,
      ...TEMPLATES[family](r),
    };
    out.push(i < families.length ? base : await mutate(base, r));
  }
  return out;
}

// ---------------------------------------------------------------------------------------
// Running and judging
// ---------------------------------------------------------------------------------------

export interface Decided {
  readonly outcome: 'ALLOW' | 'REQUIRE_APPROVAL' | 'DENY';
  readonly amountCents: number;
  /** Why, in the pipeline's words. */
  readonly note?: string | undefined;
}
/** Where a scenario is played out: the real pipeline in tests, a stub elsewhere. */
export interface LabEnv {
  order(step: OrderStep): Promise<Decided>;
}
export interface Traced extends Decided {
  readonly step: OrderStep;
  /** Minutes since the scenario began. */
  readonly at: number;
}

export async function play(env: LabEnv, scenario: Scenario): Promise<Traced[]> {
  const trace: Traced[] = [];
  let at = 0;
  for (const step of scenario.steps) {
    at += step.afterMinutes;
    trace.push({ ...(await env.order(step)), step, at });
  }
  return trace;
}

export interface Limits {
  /** The most that may be approved with no person involved in any 24 hours. */
  readonly autoSpendCents: number;
  readonly itemCapCents: number;
}
export const DEFAULT_LIMITS: Limits = { autoSpendCents: 300_000, itemCapCents: 50_000 };

export interface Violation {
  readonly invariant: string;
  readonly detail: string;
}
export interface Invariant {
  readonly id: string;
  readonly description: string;
  check(scenario: Scenario, trace: readonly Traced[]): Violation | null;
}

const allowed = (trace: readonly Traced[]) => trace.filter((t) => t.outcome === 'ALLOW');
const DAY = 1_440;

export function invariants(limits: Limits = DEFAULT_LIMITS): readonly Invariant[] {
  return [
    {
      id: 'AUTO_SPEND_BOUNDED',
      description: 'Without a person, no more than the limit is approved in any 24 hours.',
      check(_s, trace) {
        const ok = allowed(trace);
        for (const t of ok) {
          const sum = ok
            .filter((o) => o.at >= t.at - DAY && o.at <= t.at)
            .reduce((n, o) => n + o.amountCents, 0);
          if (sum > limits.autoSpendCents)
            return {
              invariant: 'AUTO_SPEND_BOUNDED',
              detail: `${sum} cents approved without a person in 24 hours.`,
            };
        }
        return null;
      },
    },
    {
      id: 'BUDGET_RESPECTED',
      description: 'Approved spending never exceeds the mission budget.',
      check(s, trace) {
        const sum = allowed(trace).reduce((n, o) => n + o.amountCents, 0);
        return sum > s.budgetCents
          ? {
              invariant: 'BUDGET_RESPECTED',
              detail: `${sum} cents approved against a budget of ${s.budgetCents}.`,
            }
          : null;
      },
    },
    {
      id: 'NO_DOUBLE_APPROVAL',
      description: 'The same order is not approved twice within an hour.',
      check(_s, trace) {
        const ok = allowed(trace);
        const same = ok.find((a, i) =>
          ok
            .slice(i + 1)
            .some(
              (b) =>
                b.step.supplier === a.step.supplier &&
                b.step.unitCents === a.step.unitCents &&
                b.step.quantity === a.step.quantity &&
                b.at - a.at <= 60,
            ),
        );
        return same === undefined
          ? null
          : {
              invariant: 'NO_DOUBLE_APPROVAL',
              detail: `Order of ${same.amountCents} cents approved twice within an hour.`,
            };
      },
    },
    {
      id: 'ITEM_CAP_HOLDS',
      description: 'No single item above the cap is approved without a person.',
      check(_s, trace) {
        const over = allowed(trace).find((t) => t.step.unitCents > limits.itemCapCents);
        return over === undefined
          ? null
          : {
              invariant: 'ITEM_CAP_HOLDS',
              detail: `An item at ${over.step.unitCents} cents was approved.`,
            };
      },
    },
  ];
}

export interface Finding {
  readonly scenario: Scenario;
  readonly violations: readonly Violation[];
}
export interface LabReport {
  readonly total: number;
  readonly byFamily: Readonly<Record<string, number>>;
  readonly findings: readonly Finding[];
}

export async function judge(
  env: LabEnv,
  scenario: Scenario,
  rules: readonly Invariant[],
): Promise<Violation[]> {
  const trace = await play(env, scenario);
  return rules.flatMap((rule) => rule.check(scenario, trace) ?? []);
}

/** Runs every scenario in a fresh environment and collects what broke. */
export async function runLab(
  makeEnv: (scenario: Scenario) => Promise<LabEnv>,
  scenarios: readonly Scenario[],
  rules: readonly Invariant[] = invariants(),
): Promise<LabReport> {
  const findings: Finding[] = [];
  const byFamily: Record<string, number> = {};
  for (const scenario of scenarios) {
    byFamily[scenario.family] = (byFamily[scenario.family] ?? 0) + 1;
    const violations = await judge(await makeEnv(scenario), scenario, rules);
    if (violations.length > 0) findings.push({ scenario, violations });
  }
  return { total: scenarios.length, byFamily, findings };
}

// ---------------------------------------------------------------------------------------
// Minimising, patching, freezing
// ---------------------------------------------------------------------------------------

/**
 * Delta debugging: removes chunks of steps while the scenario still fails, until no single step can go.
 * `fails` runs a candidate in a fresh environment. The result is 1-minimal: every step left is needed.
 */
export async function minimize(
  scenario: Scenario,
  fails: (candidate: Scenario) => Promise<boolean>,
): Promise<Scenario> {
  let steps = [...scenario.steps];
  let chunk = Math.ceil(steps.length / 2);
  while (chunk >= 1) {
    let shrunk = false;
    for (let start = 0; start < steps.length; start += chunk) {
      const rest = [...steps.slice(0, start), ...steps.slice(start + chunk)];
      if (rest.length > 0 && (await fails({ ...scenario, steps: rest }))) {
        steps = rest;
        shrunk = true;
        start -= chunk;
      }
    }
    if (!shrunk) chunk = chunk === 1 ? 0 : Math.ceil(chunk / 2);
  }
  return { ...scenario, steps };
}

/** A policy as data: the standard rules, some left out, some with changed parameters. */
export interface PolicyConfig {
  readonly without: readonly RuleId[];
  readonly overrides: Readonly<Partial<Record<RuleId, unknown>>>;
}

export const buildPolicy = (config: PolicyConfig): Policy => {
  const standard = standardPolicy(config.overrides);
  return { rules: standard.rules.filter((r) => !config.without.includes(r.rule.id)) };
};

export interface Patch {
  readonly description: string;
  readonly apply: (config: PolicyConfig) => PolicyConfig;
}

const usd = (cents: number) => ({ currency: 'USD', minor: String(cents) });

/** Changes to the policy that address a violation. They are suggestions: a person reviews them. */
export function proposePatches(
  violation: Violation,
  config: PolicyConfig,
  limits: Limits = DEFAULT_LIMITS,
): Patch[] {
  const restore = (rule: RuleId, why: string): Patch[] =>
    config.without.includes(rule)
      ? [
          {
            description: `Restore ${rule}: ${why}`,
            apply: (c) => ({ ...c, without: c.without.filter((r) => r !== rule) }),
          },
        ]
      : [];
  switch (violation.invariant) {
    case 'AUTO_SPEND_BOUNDED':
      return [
        ...restore('R-VELOCITY', 'it caps what is approved without a person in a day.'),
        {
          description: `Set R-VELOCITY to ${limits.autoSpendCents} cents a day, per supplier and across the whole organisation.`,
          apply: (c) => ({
            without: c.without.filter((r) => r !== 'R-VELOCITY'),
            overrides: {
              ...c.overrides,
              'R-VELOCITY': { max: usd(limits.autoSpendCents), orgMax: usd(limits.autoSpendCents) },
            },
          }),
        },
      ];
    case 'BUDGET_RESPECTED':
      return restore('R-ENVELOPE', 'it holds spending to the mission budget.');
    case 'NO_DOUBLE_APPROVAL':
      return restore('R-DUPLICATE', 'it stops the same order twice.');
    case 'ITEM_CAP_HOLDS':
      return [
        ...restore('R-ITEM-CAP', 'it caps a single item.'),
        {
          description: `Set R-ITEM-CAP to ${limits.itemCapCents} cents.`,
          apply: (c) => ({
            ...c,
            overrides: { ...c.overrides, 'R-ITEM-CAP': { max: usd(limits.itemCapCents) } },
          }),
        },
      ];
    default:
      return [];
  }
}

export interface Regression {
  readonly version: 1;
  readonly invariant: string;
  readonly scenario: Scenario;
  /** The policy that failed, and the one that fixed it. */
  readonly before: PolicyConfig;
  readonly after: PolicyConfig;
  readonly note: string;
}

/** A found-and-fixed case as JSON text, to be committed and replayed forever. */
export function freeze(input: Omit<Regression, 'version'>): string {
  return `${JSON.stringify({ version: 1, ...input }, null, 2)}\n`;
}

export const thaw = (text: string): Regression => JSON.parse(text) as Regression;
