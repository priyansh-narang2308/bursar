// What the API sends, as far as the screens use it. Amounts travel as minor units in a string.
export type Role = 'OWNER' | 'APPROVER' | 'OPERATOR' | 'AUDITOR' | 'AGENT' | 'VERIFIER';

export interface Me {
  kind: 'session' | 'agent';
  orgId: string;
  role: Role;
  userId: string | null;
  agentId: string | null;
}

export interface Mandate {
  id: string;
  status: 'PENDING' | 'ACTIVE' | 'FROZEN' | 'REVOKED' | 'EXPIRED' | 'COMPLETED' | string;
  currency: string;
  capMinor: string;
  perMissionCapMinor: string;
  validFrom: string;
  validTo: string;
  signedAt: string | null;
}

export interface Mission {
  id: string;
  goal: string;
  status: string;
  currency: string;
  budgetMinor: string;
  deadline: string | null;
  mandateId: string | null;
  createdAt: string;
}

export interface ActionRow {
  id: string;
  type: string;
  state: string;
  amountMinor: string | null;
  currency: string | null;
  proposedBy: string;
  createdAt: string;
}

export interface ApprovalRow {
  id: string;
  status: string;
  expiresAt: string;
  actionId: string;
  type: string;
  amountMinor: string | null;
  currency: string | null;
  proposedBy: string;
  missionId: string | null;
  createdAt: string;
}

export interface AgentKey {
  id: string;
  scopes: string[];
  createdAt: string;
  revokedAt: string | null;
}
export interface Agent {
  id: string;
  name: string;
  keys: AgentKey[];
}

export interface RuleTrace {
  rule: string;
  outcome: 'ALLOW' | 'REQUIRE_APPROVAL' | 'DENY' | 'NOT_APPLICABLE' | string;
  message: string;
}

export interface Receipt {
  action: {
    id: string;
    type: string;
    state: string;
    proposedBy: string;
    missionId: string | null;
    amountMinor: string | null;
    currency: string | null;
    createdAt: string;
  };
  cart: {
    id: string;
    version: number;
    hash: string;
    totalMinor: string;
    lines: { title: string; quantity: number; lineTotalMinor: string }[];
  } | null;
  decisions: {
    id: string;
    phase: string;
    outcome: string;
    requiredApprovals: number;
    policyHash: string;
    inputsHash: string;
    trace: RuleTrace[];
    evaluatedAt: string;
  }[];
  approvals: {
    id: string;
    status: string;
    approverId: string | null;
    signed: boolean;
    decidedAt: string | null;
    expiresAt: string;
  }[];
  executions: {
    step: string;
    requestId: string;
    status: string;
    paypalResourceId: string | null;
    debugId: string | null;
  }[];
  paypalEvents: {
    eventType: string;
    matchStatus: string;
    receivedAt: string;
  }[];
  ledger: {
    account: string;
    side: string;
    amountMinor: string;
    currency: string;
  }[];
  audit: { seq: number; type: string; ts: string; hash: string }[];
}

export interface AuditVerdict {
  ok: boolean;
  count?: number;
  reason?: string;
}

export interface RunTrace {
  needs: { label: string; query: string; quantity: number }[];
  steps: {
    need: string;
    quantity: number;
    offer: { id: string; title: string; unitMinor: string; currency: string } | undefined;
    rationale: string | null;
    citation: 'valid' | 'invalid' | 'none';
    problem: string | null;
  }[];
  proposal: {
    ok: boolean;
    data?: {
      cartId: string;
      actionId: string;
      total: string;
      state: string;
      outcome: string;
    };
    error?: { code: string; message: string };
  } | null;
  problems: string[];
  calls: {
    tool: string;
    role: string;
    ok: boolean;
    code: string | null;
    ms: number;
  }[];
}
