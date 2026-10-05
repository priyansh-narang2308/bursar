import { canonicalize, inputsHash, policyHash } from '@bursar/crypto';
import {
  type InputsHash,
  type JsonObject,
  type JsonValue,
  mergeOutcomes,
  POLICY_OUTCOMES,
  type PolicyHash,
  type PolicyOutcome,
  type RuleId,
  type RuleResult,
} from '@bursar/schemas';

/** What one rule concludes. `approvals` is how many people must approve, when it asks for approval. */
export interface Verdict {
  readonly outcome: PolicyOutcome;
  /** Plain language, written by code and never by an LLM. */
  readonly message: string;
  readonly inputs?: JsonObject;
  readonly threshold?: JsonValue;
  readonly approvals?: number;
}

/**
 * A rule is a pure function of the context and its parameters: no clock, no network, no database.
 * Anything it needs to know, including the time, arrives in the context. Bump `version` when the
 * logic changes, because it is part of the policy hash.
 */
export interface Rule<Params extends JsonValue = JsonValue> {
  readonly id: RuleId;
  readonly version: number;
  evaluate(context: JsonObject, params: Params): Verdict;
}

export interface PolicyRule {
  readonly rule: Rule<never>;
  readonly params: JsonValue;
}

/** An ordered list of rules with their parameters. */
export interface Policy {
  readonly rules: readonly PolicyRule[];
}

/** The ruling on one action: the outcome, who must approve, and the trace behind it. */
export interface Evaluation {
  readonly outcome: PolicyOutcome;
  readonly requiredApprovals: number;
  readonly trace: readonly RuleResult[];
  readonly policyHash: PolicyHash;
  readonly inputsHash: InputsHash;
}

const MAX_MESSAGE = 300;
const MAX_APPROVALS = 2;

/** The version of a policy: which rules, at which versions, with which parameters. */
export function hashPolicy(policy: Policy): PolicyHash {
  return policyHash({
    rules: policy.rules.map(({ rule, params }) => ({ id: rule.id, version: rule.version, params })),
  });
}

function isOutcome(value: unknown): value is PolicyOutcome {
  return POLICY_OUTCOMES.includes(value as PolicyOutcome);
}

/** Runs one rule. Anything that goes wrong, a throw or a nonsense answer, is a denial. */
function run({ rule, params }: PolicyRule, context: JsonObject) {
  try {
    const verdict = (rule as Rule).evaluate(context, params);
    if (!isOutcome(verdict.outcome)) {
      throw new TypeError('not an outcome');
    }
    return {
      approvals: verdict.approvals ?? 1,
      result: {
        rule: rule.id,
        outcome: verdict.outcome,
        message: verdict.message.trim().slice(0, MAX_MESSAGE) || 'No explanation given.',
        inputs: verdict.inputs ?? {},
        threshold: verdict.threshold ?? null,
      } satisfies RuleResult,
    };
  } catch {
    const message = `${rule.id} could not be evaluated, so the action is denied.`;
    return {
      approvals: 0,
      result: {
        rule: rule.id,
        outcome: 'DENY',
        message,
        inputs: {},
        threshold: null,
      } as RuleResult,
    };
  }
}

/**
 * Evaluates every rule (there is no short-circuit, so the trace is complete) and merges them: the
 * strictest outcome wins, DENY then REQUIRE_APPROVAL then ALLOW. Fail-closed: a rule that throws or
 * answers nonsense denies, and a policy with no rules denies. Deterministic: the same policy and
 * context always give the same evaluation. The context must be JSON, or this throws.
 */
export function evaluate(policy: Policy, context: JsonObject): Evaluation {
  const runs = policy.rules.map((entry) => run(entry, context));
  const trace = runs.map(({ result }) => result);
  const outcome = mergeOutcomes(trace.map((result) => result.outcome));
  const asked = runs.filter(({ result }) => result.outcome === 'REQUIRE_APPROVAL');
  const approvals = Math.min(MAX_APPROVALS, Math.max(1, ...asked.map((entry) => entry.approvals)));
  return {
    outcome,
    requiredApprovals: outcome === 'REQUIRE_APPROVAL' ? approvals : 0,
    trace,
    policyHash: hashPolicy(policy),
    inputsHash: inputsHash(context),
  };
}

/** Evaluates again and reports whether the result is exactly what was recorded. */
export function replay(
  policy: Policy,
  context: JsonObject,
  recorded: Evaluation,
): { readonly reproduced: boolean; readonly evaluation: Evaluation } {
  const evaluation = evaluate(policy, context);
  return { reproduced: canonicalize(evaluation) === canonicalize(recorded), evaluation };
}

/** A plain-language account of a ruling, built from the trace by a template. */
export function explain(evaluation: Evaluation): string {
  const said = (outcome: PolicyOutcome) =>
    evaluation.trace.filter((r) => r.outcome === outcome).map((r) => r.message);
  switch (evaluation.outcome) {
    case 'ALLOW':
      return 'Allowed: every rule passed.';
    case 'REQUIRE_APPROVAL': {
      const people = evaluation.requiredApprovals === 1 ? 'one person' : 'two different people';
      return `Needs approval from ${people}: ${said('REQUIRE_APPROVAL').join(' ')}`;
    }
    case 'DENY':
      return evaluation.trace.length === 0
        ? 'Denied: no rules apply, and with no rules nothing is allowed.'
        : `Denied: ${said('DENY').join(' ')}`;
  }
}
