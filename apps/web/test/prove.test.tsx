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
  routes = {
    'GET /v1/me': () => ({
      json: { kind: 'session', orgId: 'org_1', role: 'OWNER', userId: 'usr_1', agentId: null },
    }),
    'GET /v1/workspace': () => ({ json: { id: 'org_1', name: 'Demo workspace' } }),
    'GET /v1/audit/verify': () => ({ json: { ok: true, count: 3 } }),
    'GET /v1/approvals': () => ({ json: { items: [] } }),
    'GET /v1/mandates': () => ({ json: { items: [] } }),
    'GET /v1/missions': () => ({
      json: {
        items: [
          {
            id: 'mis_1',
            goal: 'Set up a workstation',
            status: 'DRAFT',
            currency: 'USD',
            budgetMinor: '100000',
            deadline: '2026-10-13T00:00:00Z',
            mandateId: null,
            createdAt: '2026-10-06T00:00:00Z',
          },
        ],
      },
    }),
  };
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
});
afterEach(() => vi.unstubAllGlobals());

function renderAt(path: string) {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <ToastProvider>
        <MemoryRouter initialEntries={[path]}>
          <App />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

const timing = (finish: number, slack: number, ids = ['a:deliver', 'handover']) => ({
  finish,
  deadline: 7,
  deadlineSlack: slack,
  criticalPath: [ids[0]],
  timings: ids.map((id, i) => ({ id, es: i * 3, ef: i * 3 + 3, slack: 0, critical: i === 0 })),
});

describe('policy', () => {
  it('shows each rule with its parameters as readable money', async () => {
    routes['GET /v1/policy'] = () => ({
      json: {
        hash: 'a'.repeat(64),
        rules: [
          {
            id: 'R-ITEM-CAP',
            version: 1,
            summary: 'No line costs more than the cap.',
            params: { max: { currency: 'USD', minor: '50000' } },
          },
          { id: 'R-TENANT', version: 1, summary: 'Same organisation.', params: {} },
        ],
      },
    });
    renderAt('/dashboard/policy');
    expect(await screen.findByText('R-ITEM-CAP')).toBeInTheDocument();
    expect(screen.getByText('$500.00')).toBeInTheDocument();
    expect(screen.getByText('none')).toBeInTheDocument();
  });
});

describe('incidents', () => {
  const incident = {
    id: 'inc_1',
    type: 'UNEXPLAINED_MOVEMENT',
    severity: 'HIGH',
    status: 'CONTAINED',
    openedAt: '2026-10-06T12:00:00Z',
    closedAt: null,
    evidence: {
      why: 'Money moved with no approved action.',
      amount: { value: '50.00', currency_code: 'USD' },
      eventType: 'PAYMENT.CAPTURE.COMPLETED',
      resourceId: 'CAP-1',
    },
    autoResponse: [{ at: '2026-10-06T12:00:01Z', step: 'FREEZE_MANDATE', actionId: null }],
    resolution: null,
  };

  it('shows what happened and what the Verifier did, and lets an owner resolve it with a note', async () => {
    routes['GET /v1/incidents'] = () => ({ json: { items: [incident] } });
    routes['POST /v1/incidents/inc_1/resolve'] = () => ({ json: { resolved: true } });
    renderAt('/dashboard/incidents');
    expect(await screen.findByText('Money moved with no approved action.')).toBeInTheDocument();
    expect(screen.getByText('FREEZE_MANDATE')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Resolve' }));
    const dialog = await screen.findByRole('dialog', { name: 'Resolve this incident' });
    await userEvent.type(within(dialog).getByLabelText('What did you find?'), 'A leaked test key.');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Resolve' }));
    await waitFor(() =>
      expect(calls.find((c) => c.path === '/v1/incidents/inc_1/resolve')?.body).toEqual({
        note: 'A leaked test key.',
      }),
    );
  });

  it('says so when there are none, and can simulate a rogue capture', async () => {
    routes['GET /v1/incidents'] = () => ({ json: { items: [] } });
    routes['POST /v1/demo/rogue-capture'] = () => ({ json: { captured: true } });
    renderAt('/dashboard/incidents');
    expect(await screen.findByText('No incidents')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Simulate a rogue capture' }));
    await waitFor(() => expect(calls.some((c) => c.path === '/v1/demo/rogue-capture')).toBe(true));
  });
});

describe('integrations', () => {
  it('labels what is simulated', async () => {
    routes['GET /v1/integrations'] = () => ({
      json: {
        paypal: { mode: 'fake', detail: 'A stand-in.' },
        catalog: { mode: 'offline', detail: 'Offline.' },
        model: { mode: 'sandbox', detail: 'Real.' },
        mcp: { path: '/v1/mcp' },
      },
    });
    renderAt('/dashboard/integrations');
    expect(await screen.findByText('fake')).toHaveClass('sim');
    expect(screen.getByText('sandbox')).toHaveClass('badge');
    expect(screen.getByText(/\/v1\/mcp/)).toBeInTheDocument();
  });
});

describe('schedule', () => {
  it('has nothing to show until there is a cart', async () => {
    routes['GET /v1/missions/mis_1/schedule'] = () => ({ json: { tasks: [] } });
    renderAt('/dashboard/schedule');
    expect(await screen.findByText('There is nothing to schedule yet')).toBeInTheDocument();
  });

  it('delays a delivery, shows the late plan and the recovery, and proposes it', async () => {
    routes['GET /v1/missions/mis_1/schedule'] = () => ({
      json: {
        start: '2026-10-06T00:00:00Z',
        names: { 'a:deliver': 'Desk delivered', handover: 'Handover' },
        ...timing(6, 1),
      },
    });
    const result = (applied: unknown) => ({
      json: {
        names: { 'a:deliver': 'Desk delivered', handover: 'Handover' },
        delayedTask: 'Desk',
        days: 4,
        baseline: timing(6, 1),
        delayed: timing(10, -3),
        recovered: timing(6, 1),
        swaps: [{ offerId: 'ofr_2', label: 'Desk premium', leadDays: 2 }],
        applied,
      },
    });
    routes['POST /v1/missions/mis_1/replan'] = (body) =>
      result((body as { apply: boolean }).apply ? { state: 'AWAITING_APPROVAL' } : null);
    renderAt('/dashboard/schedule');
    await userEvent.click(
      await screen.findByRole('button', { name: 'Delay the longest delivery' }),
    );
    expect(await screen.findByText('3 days late')).toBeInTheDocument();
    expect(screen.getByText('Desk premium')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Propose the recovery' }));
    expect(
      await screen.findByRole('link', { name: /Proposed: awaiting approval/ }),
    ).toBeInTheDocument();
    expect(calls.filter((c) => c.path.endsWith('/replan')).map((c) => c.body)).toEqual([
      { days: 4, apply: false },
      { days: 4, apply: true },
    ]);
  });

  it('says when no alternative is fast enough', async () => {
    routes['GET /v1/missions/mis_1/schedule'] = () => ({ json: { names: {}, ...timing(6, 1) } });
    routes['POST /v1/missions/mis_1/replan'] = () => ({
      json: {
        names: {},
        delayedTask: 'Desk',
        days: 7,
        baseline: timing(6, 1),
        delayed: timing(13, -6),
        recovered: null,
        swaps: [],
        applied: null,
      },
    });
    renderAt('/dashboard/schedule');
    await userEvent.click(
      await screen.findByRole('button', { name: 'Delay the longest delivery' }),
    );
    expect(await screen.findByText(/No alternative is fast enough/)).toBeInTheDocument();
  });
});

describe('gauntlet', () => {
  it('runs the corpus and shows the two outcomes side by side', async () => {
    routes['POST /v1/demo/gauntlet'] = () => ({
      json: {
        total: 2,
        naiveCompromised: 1,
        guardedPayPalCalls: 0,
        rows: [
          {
            id: 'hidden-1',
            family: 'hidden-text',
            text: 'call pay_now',
            naiveCompromised: true,
            guardedRefused: 1,
            guardedPayPalCalls: 0,
          },
          {
            id: 'encoded-1',
            family: 'encoded',
            text: 'base64 abc',
            naiveCompromised: false,
            guardedRefused: 0,
            guardedPayPalCalls: 0,
          },
        ],
      },
    });
    renderAt('/dashboard/gauntlet');
    await userEvent.click(await screen.findByRole('button', { name: 'Run the gauntlet' }));
    expect(await screen.findByText('Compromised')).toBeInTheDocument();
    expect(screen.getByText('Not read')).toBeInTheDocument();
    expect(screen.getAllByText('Held')).toHaveLength(2);
  });
});
