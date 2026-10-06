import { hashPolicy, RULES } from '@bursar/policy';
import type { JsonValue, OrganizationId } from '@bursar/schemas';
import type { CoreDeps } from './types';

/** The policy an organisation runs under, for people to read: each rule, what it says, and its parameters. */
export function describePolicy(deps: CoreDeps, orgId: OrganizationId) {
  const policy = deps.policyFor(orgId);
  return {
    hash: hashPolicy(policy),
    rules: policy.rules.map(({ rule, params }) => ({
      id: rule.id,
      version: rule.version,
      summary: RULES[rule.id].summary,
      params: params as JsonValue,
    })),
  };
}
