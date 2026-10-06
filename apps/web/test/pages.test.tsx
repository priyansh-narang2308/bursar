import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App';
import { ToastProvider } from '../src/components/ui';

type Handler = (body: unknown) => { status?: number; json: unknown };
let routes: Record<string, Handler>;
const calls: { method: string; path: string; body: unknown }[] = [];

beforeEach(() => {
  calls.length = 0;
  routes = {};
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
      calls.push({ method, path, body });
      const reply = routes[`${method} ${path}`]?.(body) ?? {
        status: 404,
        json: { code: 'NOT_FOUND', title: 'Not found' },
      };
      return new Response(JSON.stringify(reply.json), {
        status: reply.status ?? 200,
        headers: { 'content-type': 'application/json' },
      });
    }),
  );
  routes['GET /v1/me'] = () => ({
    json: { kind: 'session', orgId: 'org_1', role: 'OWNER', userId: 'usr_1', agentId: null },
  });
  routes['GET /v1/workspace'] = () => ({ json: { id: 'org_1', name: 'Demo workspace' } });
  routes['GET /v1/audit/verify'] = () => ({ json: { ok: true, count: 3 } });
  routes['GET /v1/approvals'] = () => ({ json: { items: [] } });
  routes['GET /v1/missions'] = () => ({ json: { items: [] } });
  routes['GET /v1/actions'] = () => ({ json: { items: [] } });
});
afterEach(() => vi.unstubAllGlobals());

const mandate = (status = 'ACTIVE') => ({
  id: 'mnd_1',
  status,
  currency: 'USD',
  capMinor: '1000000',
  perMissionCapMinor: '200000',
  validFrom: '2026-10-01T00:00:00Z',
  validTo: '2027-01-01T00:00:00Z',
  signedAt: '2026-10-02T00:00:00Z',
});
const action = {
  id: 'act_01M47YN5EGCTWCXBJNJFGA7263',
  type: 'AUTHORIZE',
  state: 'CONFIRMED',
  amountMinor: '63500',
  currency: 'USD',
  proposedBy: 'AGENT',
  createdAt: '2026-10-06T12:00:00Z',
};
const receipt = {
  action: { ...action, missionId: 'mis_1' },
  cart: {
    id: 'crt_1',
    version: 1,
    hash: 'a'.repeat(64),
    totalMinor: '63500',
    lines: [{ title: 'Standing desk basic', quantity: 1, lineTotalMinor: '32000' }],
  },
  decisions: [
    {
      id: 'dec_1',
      phase: 'PROPOSE',
      outcome: 'ALLOW',
      requiredApprovals: 0,
      policyHash: 'b'.repeat(64),
      inputsHash: 'c'.repeat(64),
      evaluatedAt: '2026-10-06T12:00:00Z',
      trace: [
        { rule: 'R-MANDATE', outcome: 'ALLOW', message: 'The mandate is active.' },
        { rule: 'R-REFUND-AUTH', outcome: 'NOT_APPLICABLE', message: 'n/a' },
      ],
    },
  ],
  approvals: [
    {
      id: 'apv_1',
      status: 'APPROVED',
      approverId: 'usr_2',
      signed: true,
      decidedAt: '2026-10-06T12:01:00Z',
      expiresAt: '2026-10-07T12:00:00Z',
    },
  ],
  executions: [
    {
      step: 'authorize',
      requestId: 'req-1',
      status: 'CONFIRMED',
      paypalResourceId: 'AUTH-1',
      debugId: 'dbg-1',
    },
  ],
  paypalEvents: [
    {
      eventType: 'PAYMENT.AUTHORIZATION.CREATED',
      matchStatus: 'MATCHED',
      receivedAt: '2026-10-06T12:02:00Z',
    },
  ],
  ledger: [{ account: 'envelope.held', side: 'DEBIT', amountMinor: '63500', currency: 'USD' }],
  audit: [{ seq: 6, type: 'action.proposed', ts: '2026-10-06T12:00:00Z', hash: 'd'.repeat(64) }],
};

function renderAt(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter initialEntries={[path]}>
          <App />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

describe('the receipt', () => {
  it('shows every stage, replays a ruling, and offers to capture a confirmed hold', async () => {
    routes['GET /v1/actions'] = () => ({ json: { items: [action] } });
    routes['GET /v1/mandates'] = () => ({ json: { items: [mandate()] } });
    routes[`GET /v1/receipts/${action.id}`] = () => ({ json: receipt });
    routes['POST /v1/decisions/dec_1/replay'] = () => ({ json: { reproduced: true, reason: '' } });
    routes['POST /v1/actions'] = () => ({ json: {} });
    renderAt('/dashboard/activity');
    await userEvent.click(await screen.findByText('Confirmed'));
    const drawer = await screen.findByRole('dialog', { name: 'Details' });
    expect(await within(drawer).findByText('Standing desk basic')).toBeInTheDocument();
    expect(within(drawer).getByText('R-MANDATE')).toBeInTheDocument();
    expect(within(drawer).queryByText('R-REFUND-AUTH')).not.toBeInTheDocument(); // rules that did not apply are left out
    expect(within(drawer).getByText('PAYMENT.AUTHORIZATION.CREATED')).toBeInTheDocument();
    expect(within(drawer).getByText('envelope.held')).toBeInTheDocument();
    await userEvent.click(within(drawer).getByRole('button', { name: 'Replay' }));
    expect(await screen.findByText(/Replayed: the same outcome/)).toBeInTheDocument();
    await userEvent.click(within(drawer).getByRole('button', { name: 'Capture payment' }));
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'POST' && c.path === '/v1/actions')?.body).toEqual({
        type: 'CAPTURE',
        missionId: 'mis_1',
        cartId: 'crt_1',
      }),
    );
  });
});

describe('the mandate', () => {
  it('shows limits and revokes after a confirmation', async () => {
    routes['GET /v1/mandates'] = () => ({
      json: { items: [mandate(), { ...mandate('REVOKED'), id: 'mnd_0' }] },
    });
    routes['POST /v1/mandates/mnd_1/revoke'] = () => ({ json: {} });
    renderAt('/dashboard/mandate');
    expect((await screen.findAllByText('$10,000.00')).length).toBeGreaterThan(0);
    expect(screen.getByText('All mandates')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Revoke' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Revoke for good' }));
    await waitFor(() =>
      expect(calls.some((c) => c.path === '/v1/mandates/mnd_1/revoke')).toBe(true),
    );
  });

  it('creates a mandate and waits for the buyer, who is simulated in the demo', async () => {
    routes['GET /v1/mandates'] = () => ({ json: { items: [] } });
    routes['POST /v1/mandates'] = () => ({
      json: { mandateId: 'mnd_2', setupTokenId: 'tok_1', approveUrl: 'https://paypal.test/x' },
    });
    routes['POST /v1/demo/mandates/mnd_2/approve'] = () => ({ json: { approved: true } });
    renderAt('/dashboard/mandate');
    expect(await screen.findByText('No mandate yet')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'New mandate' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Create and ask the buyer' }));
    expect(calls.find((c) => c.method === 'POST' && c.path === '/v1/mandates')?.body).toMatchObject(
      { cap: { currency: 'USD', minor: '1000000' }, perMissionCap: { minor: '200000' } },
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Approve as the buyer' }));
    await waitFor(() =>
      expect(calls.some((c) => c.path === '/v1/demo/mandates/mnd_2/approve')).toBe(true),
    );
  });
});

describe('missions', () => {
  it('creates a mission with a budget typed in dollars, sent as exact cents', async () => {
    routes['GET /v1/mandates'] = () => ({ json: { items: [mandate()] } });
    routes['POST /v1/missions'] = () => ({ json: { id: 'mis_9' } });
    renderAt('/dashboard/missions');
    expect(await screen.findByText('No missions yet')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'New mission' }));
    const dialog = await screen.findByRole('dialog', { name: 'New mission' });
    await userEvent.type(within(dialog).getByLabelText('Goal'), 'Two monitors');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create mission' }));
    await waitFor(() =>
      expect(
        calls.find((c) => c.method === 'POST' && c.path === '/v1/missions')?.body,
      ).toMatchObject({
        goal: 'Two monitors',
        budget: { currency: 'USD', minor: '200000' },
        mandateId: 'mnd_1',
      }),
    );
  });
});

describe('agents and keys', () => {
  it('creates an agent, shows a new key once with the connect command, and revokes a key', async () => {
    const agents = [
      {
        id: 'agt_1',
        name: 'Buyer',
        keys: [
          {
            id: 'key_1',
            scopes: ['missions:read'],
            createdAt: '2026-10-06T12:00:00Z',
            revokedAt: null,
          },
        ],
      },
    ];
    routes['GET /v1/agents'] = () => ({ json: { items: agents } });
    routes['POST /v1/agents'] = () => ({ status: 201, json: { id: 'agt_2' } });
    routes['POST /v1/agents/agt_1/keys'] = () => ({
      status: 201,
      json: { id: 'key_2', key: 'bk_secret', scopes: [] },
    });
    routes['DELETE /v1/agents/agt_1/keys/key_1'] = () => ({ json: {} });
    renderAt('/dashboard/agents');
    await userEvent.type(await screen.findByLabelText('Agent name'), 'Procurement bot');
    await userEvent.click(screen.getByRole('button', { name: 'Create agent' }));
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'POST' && c.path === '/v1/agents')?.body).toEqual({
        name: 'Procurement bot',
      }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Issue key' }));
    const dialog = await screen.findByRole('dialog', { name: 'Your new key' });
    expect(within(dialog).getByDisplayValue('bk_secret')).toBeInTheDocument();
    expect(
      (within(dialog).getByLabelText('Connect Claude Code') as HTMLTextAreaElement).value,
    ).toContain('claude mcp add --transport http bursar');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Done' }));
    await userEvent.click(screen.getByRole('button', { name: 'Revoke' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE')).toBe(true));
  });
});

describe('moving around', () => {
  it('opens the command palette with the keyboard and goes to a page', async () => {
    routes['GET /v1/mandates'] = () => ({ json: { items: [mandate()] } });
    renderAt('/dashboard');
    await screen.findByText('Audit chain verified');
    await userEvent.keyboard('{Control>}k{/Control}');
    await userEvent.type(await screen.findByLabelText('Go to', { selector: 'input' }), 'appro');
    await userEvent.keyboard('{Enter}');
    expect(await screen.findByRole('heading', { name: 'Approvals' })).toBeInTheDocument();
  });

  it('switches the role being viewed', async () => {
    routes['GET /v1/mandates'] = () => ({ json: { items: [mandate()] } });
    routes['POST /v1/demo/role'] = () => ({ json: { role: 'AUDITOR' } });
    renderAt('/dashboard');
    await userEvent.selectOptions(await screen.findByLabelText('View as role'), 'AUDITOR');
    await waitFor(() =>
      expect(calls.find((c) => c.path === '/v1/demo/role')?.body).toEqual({ role: 'AUDITOR' }),
    );
  });

  it('shows resume instead of freeze when the mandate is frozen', async () => {
    routes['GET /v1/mandates'] = () => ({ json: { items: [mandate('FROZEN')] } });
    renderAt('/dashboard');
    expect(await screen.findByRole('button', { name: /resume spending/i })).toBeInTheDocument();
  });

  it('has a design-system gallery', async () => {
    renderAt('/_ui');
    expect(await screen.findByRole('heading', { name: 'Design system' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Open dialog' }));
    expect(await screen.findByRole('dialog', { name: 'A dialog' })).toBeInTheDocument();
  });
});
