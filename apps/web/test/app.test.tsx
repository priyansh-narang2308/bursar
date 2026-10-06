import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App';
import { ToastProvider } from '../src/components/ui';

// Studio draws on canvases and observers that jsdom does not have, so the page is tested against a stand-in.
vi.mock('ag-studio', () => ({
  studioTheme: { withParams: () => ({}) },
  AgStudioAiModule: {},
  createAiHarness: () => ({}),
  directLlmRunner: (config: unknown) => config,
}));
vi.mock('ag-studio-react', () => ({
  createWidgets: () => ({}),
  AgStudioProvider: ({ children }: { children: unknown }) => children,
  AgStudio: ({ data }: { data: { sources: { id: string; data: unknown[] }[] } }) => (
    <div data-testid="studio">{data.sources.map((s) => `${s.id}:${s.data.length}`).join(' ')}</div>
  ),
}));

const emptyCockpit = {
  generatedAt: '2026-10-05T12:00:00Z',
  envelopes: [],
  decisions: [],
  ruleHits: [],
  flows: [],
  verification: { confirmed: 0, waiting: 0, unexplained: 0 },
  incidents: [],
};

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
      const handler = routes[`${method} ${path}`];
      const reply = handler
        ? handler(body)
        : { status: 404, json: { code: 'NOT_FOUND', title: 'Not found' } };
      return new Response(JSON.stringify(reply.json), {
        status: reply.status ?? 200,
        headers: { 'content-type': 'application/json' },
      });
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

const me = (role = 'OWNER') => ({
  kind: 'session',
  orgId: 'org_1',
  role,
  userId: 'usr_1',
  agentId: null,
});
const mandate = {
  id: 'mnd_1',
  status: 'ACTIVE',
  currency: 'USD',
  capMinor: '1000000',
  perMissionCapMinor: '200000',
  validFrom: '2026-10-01T00:00:00Z',
  validTo: '2027-01-01T00:00:00Z',
  signedAt: '2026-10-02T00:00:00Z',
};
const mission = {
  id: 'mis_1',
  goal: 'Set up a workstation',
  status: 'DRAFT',
  currency: 'USD',
  budgetMinor: '100000',
  deadline: '2026-10-13T00:00:00Z',
  mandateId: 'mnd_1',
  createdAt: '2026-10-06T00:00:00Z',
};
const approval = {
  id: 'apv_1',
  status: 'PENDING',
  expiresAt: '2026-10-07T00:00:00Z',
  actionId: 'act_01M47YN5EGCTWCXBJNJFGA7263',
  type: 'AUTHORIZE',
  amountMinor: '63500',
  currency: 'USD',
  proposedBy: 'AGENT',
  missionId: 'mis_1',
  createdAt: '2026-10-06T00:00:00Z',
};

function signedIn(role = 'OWNER') {
  routes['GET /v1/me'] = () => ({ json: me(role) });
  routes['GET /v1/workspace'] = () => ({ json: { id: 'org_1', name: 'Demo workspace' } });
  routes['GET /v1/mandates'] = () => ({ json: { items: [mandate] } });
  routes['GET /v1/missions'] = () => ({ json: { items: [mission] } });
  routes['GET /v1/actions'] = () => ({ json: { items: [] } });
  routes['GET /v1/approvals'] = () => ({ json: { items: [approval] } });
  routes['GET /v1/audit/verify'] = () => ({ json: { ok: true, count: 7 } });
}

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

describe('the public pages', () => {
  it('serve the security model and the limits without a session', async () => {
    routes['GET /v1/me'] = () => ({
      status: 401,
      json: { code: 'UNAUTHENTICATED', title: 'Sign in' },
    });
    renderAt('/security');
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent(
      'Bursar keeps agents',
    );
    cleanup();
    renderAt('/limits');
    expect(await screen.findByRole('heading', { name: /what this demo is/i })).toBeInTheDocument();
    expect(screen.getByText(/sandbox money only/i)).toBeInTheDocument();
  });

  it('sets out what is real and what is simulated in a table', async () => {
    routes['GET /v1/me'] = () => ({
      status: 401,
      json: { code: 'UNAUTHENTICATED', title: 'Sign in' },
    });
    renderAt('/');
    const table = await screen.findByRole('table', { name: /real and simulated/i });
    expect(within(table).getByRole('rowheader', { name: 'PayPal' })).toBeInTheDocument();
  });
});

describe('the sidebar trigger', () => {
  beforeEach(() => window.localStorage.removeItem('bursar.sidebar'));

  it('closes and opens the sidebar, remembers the choice, and answers Ctrl+B', async () => {
    signedIn();
    const { container } = renderAt('/dashboard');
    const trigger = await screen.findByRole('button', { name: 'Toggle sidebar' });
    const app = () => container.querySelector('.app');
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(app()).toHaveAttribute('data-sidebar', 'open');

    await userEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(app()).toHaveAttribute('data-sidebar', 'closed');
    expect(window.localStorage.getItem('bursar.sidebar')).toBe('closed');

    await userEvent.keyboard('{Control>}b{/Control}');
    expect(app()).toHaveAttribute('data-sidebar', 'open');
    expect(window.localStorage.getItem('bursar.sidebar')).toBe('open');
  });

  it('starts closed when the person last left it closed', async () => {
    window.localStorage.setItem('bursar.sidebar', 'closed');
    signedIn();
    const { container } = renderAt('/dashboard');
    await screen.findByRole('button', { name: 'Toggle sidebar' });
    expect(container.querySelector('.app')).toHaveAttribute('data-sidebar', 'closed');
  });
});

describe('the landing page', () => {
  it('opens a populated demo workspace in one click and lands on the dashboard', async () => {
    routes['GET /v1/me'] = () => ({
      status: 401,
      json: { code: 'UNAUTHENTICATED', title: 'Sign in' },
    });
    routes['POST /v1/demo/workspace'] = () => {
      signedIn();
      return { status: 201, json: { orgId: 'org_1' } };
    };
    renderAt('/');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Smart agents');
    await userEvent.click(
      (await screen.findAllByRole('button', { name: 'Open demo workspace' }))[0] as HTMLElement,
    );
    expect(await screen.findByRole('heading', { name: 'Overview' })).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'POST' && c.path === '/v1/demo/workspace')).toBe(true);
  });

  it('offers the dashboard straight away to someone who already has a workspace', async () => {
    signedIn();
    renderAt('/');
    expect((await screen.findAllByRole('link', { name: /dashboard/i }))[0]).toHaveAttribute(
      'href',
      '/dashboard',
    );
  });
});

describe('the dashboard', () => {
  it('asks for a workspace when there is none', async () => {
    routes['GET /v1/me'] = () => ({
      status: 401,
      json: { code: 'UNAUTHENTICATED', title: 'Sign in' },
    });
    renderAt('/dashboard');
    expect(await screen.findByText('There is no workspace open')).toBeInTheDocument();
  });

  it('always shows the mandate and the freeze control, and a guided tour', async () => {
    signedIn();
    renderAt('/dashboard');
    expect(await screen.findByRole('button', { name: /freeze/i })).toBeInTheDocument();
    expect(await screen.findByText('Audit chain verified')).toBeInTheDocument();
    expect(screen.getByText('Try it in three steps')).toBeInTheDocument();
    expect(screen.getByText('$10,000.00')).toBeInTheDocument();
  });

  it('freezes spending after a confirmation, with the reason', async () => {
    signedIn();
    routes['POST /v1/mandates/mnd_1/freeze'] = () => ({ json: { status: 'FROZEN' } });
    renderAt('/dashboard');
    await userEvent.click(await screen.findByRole('button', { name: /freeze/i }));
    const dialog = await screen.findByRole('dialog', { name: 'Freeze all spending?' });
    await userEvent.type(within(dialog).getByLabelText('Reason (optional)'), 'Suspicious');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Freeze now' }));
    await waitFor(() =>
      expect(calls.find((c) => c.path === '/v1/mandates/mnd_1/freeze')?.body).toEqual({
        reason: 'Suspicious',
      }),
    );
  });

  it('does not offer the freeze button to someone who cannot use it', async () => {
    signedIn('AUDITOR');
    renderAt('/dashboard');
    await screen.findByText('Audit chain verified');
    expect(screen.queryByRole('button', { name: /freeze/i })).not.toBeInTheDocument();
  });

  it('approves a proposal and says what PayPal did', async () => {
    signedIn();
    routes['POST /v1/approvals/apv_1/decide'] = () => ({
      json: { state: 'APPROVED', execution: { outcome: 'confirmed' } },
    });
    renderAt('/dashboard/approvals');
    expect(await screen.findByText('$635.00')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect(await screen.findByText(/PayPal: confirmed/)).toBeInTheDocument();
    expect(calls.find((c) => c.path === '/v1/approvals/apv_1/decide')?.body).toEqual({
      decision: 'APPROVE',
    });
  });

  it('explains why an auditor cannot decide', async () => {
    signedIn('AUDITOR');
    renderAt('/dashboard/approvals');
    expect(await screen.findByText(/cannot decide approvals/)).toBeInTheDocument();
  });

  it('runs the agents on a mission and shows the trace and the proposal', async () => {
    signedIn();
    routes['POST /v1/missions/mis_1/run'] = () => ({
      json: {
        needs: [{ label: 'desks', query: 'standing desk', quantity: 1 }],
        steps: [
          {
            need: 'desks',
            quantity: 1,
            offer: {
              id: 'ofr_1',
              title: 'Standing desk basic',
              unitMinor: '32000',
              currency: 'USD',
            },
            rationale: 'Cheapest in stock.',
            citation: 'valid',
            problem: null,
          },
        ],
        proposal: {
          ok: true,
          data: {
            cartId: 'crt_1',
            actionId: 'act_1',
            total: 'USD 320.00',
            state: 'AWAITING_APPROVAL',
            outcome: 'REQUIRE_APPROVAL',
          },
        },
        problems: [],
        ranOn: 'render-workflow',
        calls: [{ tool: 'search_offers', role: 'RESEARCHER', ok: true, code: null, ms: 12 }],
      },
    });
    renderAt('/dashboard/missions/mis_1');
    await userEvent.click(await screen.findByRole('button', { name: /run agents/i }));
    expect(await screen.findByText('Standing desk basic')).toBeInTheDocument();
    expect(screen.getByText('Pending approval')).toBeInTheDocument();
    expect(screen.getByText('search_offers')).toBeInTheDocument();
    expect(screen.getByText('Ran on a Render Workflow')).toBeInTheDocument();
  });

  it('shows a blocked proposal as blocked, not approved', async () => {
    signedIn();
    routes['POST /v1/missions/mis_1/run'] = () => ({
      json: {
        needs: [],
        steps: [],
        proposal: {
          ok: true,
          data: { cartId: 'c', actionId: 'a', total: 'USD 1.00', state: 'DENIED', outcome: 'DENY' },
        },
        problems: [],
        calls: [],
      },
    });
    renderAt('/dashboard/missions/mis_1');
    await userEvent.click(await screen.findByRole('button', { name: /run agents/i }));
    expect(await screen.findByText('Blocked')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'See why it was blocked' })).toBeInTheDocument();
  });

  it('keeps an API failure readable', async () => {
    signedIn();
    routes['GET /v1/agents'] = () => ({
      status: 500,
      json: { code: 'INTERNAL_ERROR', title: 'Something went wrong on our side' },
    });
    renderAt('/dashboard/agents');
    expect(await screen.findByText('That didn’t load')).toBeInTheDocument();
  });

  it('opens the Studio cockpit, and says plainly when there is nothing to chart yet', async () => {
    signedIn();
    routes['GET /v1/cockpit'] = () => ({ status: 200, json: emptyCockpit });
    renderAt('/dashboard/studio');
    expect(await screen.findByRole('heading', { name: 'Studio' })).toBeInTheDocument();
    expect(await screen.findByText('Nothing to chart yet')).toBeInTheDocument();
  });

  it('draws the cockpit from the figures the server sent', async () => {
    signedIn();
    routes['GET /v1/cockpit'] = () => ({
      status: 200,
      json: {
        ...emptyCockpit,
        decisions: [
          {
            id: 'dec_1',
            actionId: 'act_1',
            type: 'AUTHORIZE',
            state: 'AWAITING_APPROVAL',
            outcome: 'REQUIRE_APPROVAL',
            requiredApprovals: 1,
            amount: { currency: 'USD', minor: '300000' },
            evaluatedAt: '2026-10-05T12:00:00Z',
            rules: [{ rule: 'R-NEW-VENDOR', outcome: 'REQUIRE_APPROVAL', message: 'First order' }],
          },
        ],
      },
    });
    renderAt('/dashboard/studio');
    expect(await screen.findByTestId('studio')).toHaveTextContent('decisions:1');
    expect(screen.getByRole('button', { name: 'Edit layout' })).toBeInTheDocument();
  });
});
