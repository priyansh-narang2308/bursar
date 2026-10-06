import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ReceiptDrawer } from '../components/ReceiptDrawer';
import {
  Badge,
  Dialog,
  EmptyState,
  ErrorNote,
  Field,
  Icon,
  IdChip,
  MoneyAmount,
  Panel,
  SimBadge,
  StateBadge,
  TableSkeleton,
  toneOf,
  useToast,
} from '../components/ui';
import { api } from '../lib/api';
import { formatDay, humanize, minorFromInput } from '../lib/format';
import { currentMandate, useMandates, useMissions } from '../lib/queries';
import type { RunTrace } from '../lib/types';
import { PageHead } from './parts';

function NewMission({ onClose }: { onClose: () => void }) {
  const mandates = useMandates();
  const mandate = currentMandate(mandates.data);
  const [goal, setGoal] = useState('');
  const [budget, setBudget] = useState('2000');
  const [days, setDays] = useState('7');
  const client = useQueryClient();
  const navigate = useNavigate();
  const toast = useToast();
  const minor = minorFromInput(budget);
  const create = useMutation({
    mutationFn: () =>
      api.post<{ id: string }>('/v1/missions', {
        goal,
        budget: { currency: 'USD', minor },
        deadline: new Date(Date.now() + Number(days) * 86_400_000).toISOString(),
        mandateId: mandate?.id,
      }),
    onSuccess: (m) => {
      void client.invalidateQueries({ queryKey: ['missions'] });
      onClose();
      navigate(`/dashboard/missions/${m.id}`);
    },
    onError: (e: Error) => toast('bad', (e as { readable?: string }).readable ?? e.message),
  });
  const ready =
    goal.trim().length > 3 && minor !== null && Number(days) > 0 && mandate !== undefined;
  return (
    <Dialog
      title="New mission"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!ready || create.isPending}
            onClick={() => create.mutate()}
          >
            Create mission
          </button>
        </>
      }
    >
      <Field
        label="Goal"
        hint="In plain words, such as “Equip a team with 4 standing desks and 4 office chairs”."
      >
        {(id) => (
          <textarea
            id={id}
            className="textarea"
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
          />
        )}
      </Field>
      <div className="grid-2">
        <Field label="Budget (USD)">
          {(id) => (
            <input
              id={id}
              className="input num"
              inputMode="decimal"
              value={budget}
              onChange={(e) => setBudget(e.target.value)}
            />
          )}
        </Field>
        <Field label="Needed within (days)">
          {(id) => (
            <input
              id={id}
              className="input num"
              inputMode="numeric"
              value={days}
              onChange={(e) => setDays(e.target.value)}
            />
          )}
        </Field>
      </div>
      {!mandate && (
        <p className="callout callout-warn">
          There is no mandate yet. Create one first so spending has limits.
        </p>
      )}
    </Dialog>
  );
}

export function Missions() {
  const missions = useMissions();
  const [creating, setCreating] = useState(false);
  const navigate = useNavigate();
  return (
    <div className="content">
      <PageHead
        title="Missions"
        sub="A mission is a goal with a budget and a deadline. Agents plan it, research each need and propose one cart; the policy decides what happens next."
        action={
          <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
            New mission
          </button>
        }
      />
      <Panel flush>
        {missions.isPending && <TableSkeleton />}
        {missions.isError && (
          <ErrorNote error={missions.error} retry={() => void missions.refetch()} />
        )}
        {missions.data?.length === 0 && (
          <EmptyState title="No missions yet">Create one and let the agents work on it.</EmptyState>
        )}
        {missions.data && missions.data.length > 0 && (
          <table className="table">
            <thead>
              <tr>
                <th>Goal</th>
                <th>Status</th>
                <th className="right">Budget</th>
                <th className="right">Needed by</th>
              </tr>
            </thead>
            <tbody>
              {missions.data.map((m) => (
                <tr key={m.id} data-click onClick={() => navigate(`/dashboard/missions/${m.id}`)}>
                  <td style={{ maxWidth: 460 }}>{m.goal}</td>
                  <td>
                    <StateBadge state={m.status} />
                  </td>
                  <td className="right">
                    <MoneyAmount minor={m.budgetMinor} currency={m.currency} />
                  </td>
                  <td className="right faint">{formatDay(m.deadline)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
      {creating && <NewMission onClose={() => setCreating(false)} />}
    </div>
  );
}

const STATUS_NOTE: Record<string, string> = {
  PENDING_APPROVAL:
    'A person must approve this before anything is paid. It is waiting in Approvals.',
  APPROVED: 'Within policy, so it was approved without a person.',
  BLOCKED: 'The policy refused this proposal. Nothing will be spent.',
};

function statusOf(proposal: RunTrace['proposal']): string {
  if (!proposal?.ok || !proposal.data) return 'BLOCKED';
  if (proposal.data.outcome === 'DENY') return 'BLOCKED';
  return proposal.data.state === 'AWAITING_APPROVAL' ? 'PENDING_APPROVAL' : 'APPROVED';
}

function Trace({ trace, onReceipt }: { trace: RunTrace; onReceipt: (actionId: string) => void }) {
  const proposal = trace.proposal;
  const status = statusOf(proposal);
  return (
    <ol className="timeline">
      <li data-tone="ok">
        <span className="row">
          <strong>Planner</strong>{' '}
          <span className="faint">
            broke the goal into {trace.needs.length} need
            {trace.needs.length === 1 ? '' : 's'}
          </span>
        </span>
        <span className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
          {trace.needs.map((n) => (
            <Badge key={n.label} plain>
              {n.quantity} × {n.label}
            </Badge>
          ))}
        </span>
      </li>
      {trace.steps.map((s) => (
        <li key={s.need} data-tone={s.offer ? 'ok' : 'warn'}>
          <span className="row">
            <strong>Researcher</strong> <span className="faint">{s.need}</span>
          </span>
          {s.offer ? (
            <span className="muted">
              Chose{' '}
              <strong style={{ color: 'var(--text)' }}>
                {s.offer.title.replace(/<[^>]*>/g, '')}
              </strong>{' '}
              at <MoneyAmount minor={s.offer.unitMinor} currency={s.offer.currency} /> each, ×{' '}
              {s.quantity}.{' '}
              {s.citation === 'valid' && (
                <Badge tone="ok" plain>
                  Cited a real offer
                </Badge>
              )}
            </span>
          ) : (
            <span className="muted">{s.problem ?? 'Nothing suitable was found.'}</span>
          )}
          {s.rationale && <span className="faint">{s.rationale}</span>}
        </li>
      ))}
      <li data-tone={toneOf(status)}>
        <span className="row">
          <strong>Buyer</strong> <Badge tone={toneOf(status)}>{humanize(status)}</Badge>
        </span>
        {proposal?.ok && proposal.data ? (
          <span className="muted">
            Proposed a cart of{' '}
            <strong style={{ color: 'var(--text)' }}>
              {proposal.data.total.replace('USD ', '$')}
            </strong>
            , priced by the server. {STATUS_NOTE[status]}
          </span>
        ) : (
          <span className="muted">{proposal?.error?.message ?? 'No proposal was made.'}</span>
        )}
        {proposal?.ok && proposal.data && (
          <button
            type="button"
            className="btn btn-sm"
            style={{ justifySelf: 'start' }}
            onClick={() => onReceipt(proposal.data?.actionId ?? '')}
          >
            {status === 'BLOCKED' ? 'See why it was blocked' : 'Open receipt'}
          </button>
        )}
        {proposal?.ok && status === 'PENDING_APPROVAL' && (
          <Link className="btn btn-sm" style={{ justifySelf: 'start' }} to="/dashboard/approvals">
            Go to approvals <Icon name="arrow" />
          </Link>
        )}
      </li>
    </ol>
  );
}

export function MissionDetail() {
  const { id = '' } = useParams();
  const missions = useMissions();
  const mission = missions.data?.find((m) => m.id === id);
  const client = useQueryClient();
  const toast = useToast();
  const traceKey = ['trace', id];
  const [receipt, setReceipt] = useState<string | null>(null);
  const cached = useQuery<RunTrace | null>({
    queryKey: traceKey,
    queryFn: () => null,
    enabled: false,
    initialData: null,
  });
  const run = useMutation({
    mutationFn: () => api.post<RunTrace>(`/v1/missions/${id}/run`),
    onSuccess: (trace) => {
      client.setQueryData(traceKey, trace);
      void client.invalidateQueries({ queryKey: ['approvals'] });
      void client.invalidateQueries({ queryKey: ['actions'] });
    },
    onError: (e: Error) => toast('bad', (e as { readable?: string }).readable ?? e.message),
  });
  if (missions.isPending)
    return (
      <div className="content">
        <TableSkeleton rows={3} />
      </div>
    );
  if (!mission)
    return (
      <div className="content">
        <ErrorNote error={new Error('No such mission.')} />
      </div>
    );
  const trace = cached.data;
  return (
    <div className="content">
      <PageHead
        title={mission.goal}
        sub={
          <span className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
            <StateBadge state={mission.status} />{' '}
            <MoneyAmount minor={mission.budgetMinor} currency={mission.currency} /> budget{' '}
            <span className="faint">· needed by {formatDay(mission.deadline)}</span>{' '}
            <IdChip id={mission.id} />
          </span>
        }
        action={
          <span className="row">
            <SimBadge>scripted model</SimBadge>
            <button
              type="button"
              className="btn btn-primary"
              disabled={run.isPending}
              onClick={() => run.mutate()}
            >
              <Icon name="play" />{' '}
              {run.isPending ? 'Agents working…' : trace ? 'Run again' : 'Run agents'}
            </button>
          </span>
        }
      />
      <Panel
        title={
          <span className="row">
            Agent trace
            {trace?.ranOn === 'render-workflow' && (
              <Badge tone="ok" plain>
                Ran on a Render Workflow
              </Badge>
            )}
          </span>
        }
      >
        {!trace && !run.isPending && (
          <EmptyState title="The agents have not run yet">
            Press Run agents. The Planner splits the goal, a Researcher searches the catalog for
            each need, and the Buyer proposes one cart. They never see or state a price they could
            be held to.
          </EmptyState>
        )}
        {run.isPending && <TableSkeleton rows={3} />}
        {trace && !run.isPending && <Trace trace={trace} onReceipt={setReceipt} />}
      </Panel>
      {trace && !run.isPending && (
        <Panel title="Tool calls" flush>
          <table className="table">
            <thead>
              <tr>
                <th>Role</th>
                <th>Tool</th>
                <th>Result</th>
                <th className="right">Time</th>
              </tr>
            </thead>
            <tbody>
              {trace.calls.map((c, i) => (
                <tr key={`${c.tool}-${i + 1}`}>
                  <td className="muted">{humanize(c.role)}</td>
                  <td className="mono">{c.tool}</td>
                  <td>
                    <Badge tone={c.ok ? 'ok' : 'bad'} plain>
                      {c.ok ? 'ok' : (c.code ?? 'error')}
                    </Badge>
                  </td>
                  <td className="right faint num">{c.ms} ms</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}
      {receipt && <ReceiptDrawer actionId={receipt} onClose={() => setReceipt(null)} />}
    </div>
  );
}
