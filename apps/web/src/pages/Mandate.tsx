import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  Badge,
  Dialog,
  EmptyState,
  ErrorNote,
  Field,
  IdChip,
  MoneyAmount,
  Panel,
  SimBadge,
  StateBadge,
  TableSkeleton,
  useToast,
} from '../components/ui';
import { api } from '../lib/api';
import { formatDay, minorFromInput } from '../lib/format';
import { currentMandate, useMandates, useMe } from '../lib/queries';
import { PageHead } from './parts';

interface Started {
  mandateId: string;
  setupTokenId: string;
  approveUrl: string;
}

function NewMandate({ onClose }: { onClose: () => void }) {
  const [payer, setPayer] = useState('Sample buyer');
  const [cap, setCap] = useState('10000');
  const [perMission, setPerMission] = useState('2000');
  const [days, setDays] = useState('90');
  const [started, setStarted] = useState<Started | null>(null);
  const client = useQueryClient();
  const toast = useToast();
  const capMinor = minorFromInput(cap);
  const perMinor = minorFromInput(perMission);
  const create = useMutation({
    mutationFn: () =>
      api.post<Started>('/v1/mandates', {
        payerName: payer,
        cap: { currency: 'USD', minor: capMinor },
        perMissionCap: { currency: 'USD', minor: perMinor },
        validFrom: new Date().toISOString(),
        validTo: new Date(Date.now() + Number(days) * 86_400_000).toISOString(),
        returnUrl: `${window.location.origin}/dashboard/mandate`,
        cancelUrl: `${window.location.origin}/dashboard/mandate`,
      }),
    onSuccess: (s) => {
      setStarted(s);
      void client.invalidateQueries({ queryKey: ['mandates'] });
    },
    onError: (e: Error) => toast('bad', (e as { readable?: string }).readable ?? e.message),
  });
  const approve = useMutation({
    mutationFn: () => api.post(`/v1/demo/mandates/${started?.mandateId}/approve`),
    onSuccess: () => {
      toast('ok', 'The buyer approved. The mandate is active.');
      void client.invalidateQueries();
      onClose();
    },
    onError: (e: Error) => toast('bad', (e as { readable?: string }).readable ?? e.message),
  });
  const ready = capMinor !== null && perMinor !== null && payer.trim() !== '' && Number(days) > 0;
  return (
    <Dialog
      title={started ? 'Waiting for the buyer' : 'New mandate'}
      onClose={onClose}
      footer={
        started ? (
          <>
            <button type="button" className="btn" onClick={onClose}>
              Close
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={approve.isPending}
              onClick={() => approve.mutate()}
            >
              Approve as the buyer
            </button>
          </>
        ) : (
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
              Create and ask the buyer
            </button>
          </>
        )
      }
    >
      {started ? (
        <>
          <p className="muted">
            The buyer approves saving their PayPal as a payment method on PayPal’s own page. Until
            they do, the mandate cannot spend. In this demo there is no buyer to click, so the
            button below stands in for them <SimBadge>sim</SimBadge>.
          </p>
          <p className="faint">
            Setup token <IdChip id={started.setupTokenId} />
          </p>
        </>
      ) : (
        <>
          <Field label="Buyer’s name">
            {(id) => (
              <input
                id={id}
                className="input"
                value={payer}
                onChange={(e) => setPayer(e.target.value)}
              />
            )}
          </Field>
          <div className="grid-2">
            <Field label="Total cap (USD)" hint="Most that can ever be spent.">
              {(id) => (
                <input
                  id={id}
                  className="input num"
                  value={cap}
                  onChange={(e) => setCap(e.target.value)}
                />
              )}
            </Field>
            <Field label="Per mission (USD)" hint="Most for any one mission.">
              {(id) => (
                <input
                  id={id}
                  className="input num"
                  value={perMission}
                  onChange={(e) => setPerMission(e.target.value)}
                />
              )}
            </Field>
          </div>
          <Field label="Valid for (days)">
            {(id) => (
              <input
                id={id}
                className="input num"
                value={days}
                onChange={(e) => setDays(e.target.value)}
              />
            )}
          </Field>
        </>
      )}
    </Dialog>
  );
}

function RevokeButton({ id }: { id: string }) {
  const [open, setOpen] = useState(false);
  const client = useQueryClient();
  const toast = useToast();
  const revoke = useMutation({
    mutationFn: () => api.post(`/v1/mandates/${id}/revoke`, { reason: 'Revoked by the owner' }),
    onSuccess: () => {
      toast('ok', 'Revoked. This mandate can never spend again.');
      setOpen(false);
      void client.invalidateQueries();
    },
    onError: (e: Error) => toast('bad', (e as { readable?: string }).readable ?? e.message),
  });
  return (
    <>
      <button type="button" className="btn btn-sm btn-danger" onClick={() => setOpen(true)}>
        Revoke
      </button>
      {open && (
        <Dialog
          title="Revoke this mandate?"
          onClose={() => setOpen(false)}
          footer={
            <>
              <button type="button" className="btn" onClick={() => setOpen(false)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-danger"
                disabled={revoke.isPending}
                onClick={() => revoke.mutate()}
              >
                Revoke for good
              </button>
            </>
          }
        >
          <p className="muted">
            Revoking is permanent, unlike freezing. Holds already placed are released. Create a new
            mandate to spend again.
          </p>
        </Dialog>
      )}
    </>
  );
}

export function Mandate() {
  const mandates = useMandates();
  const me = useMe();
  const [creating, setCreating] = useState(false);
  const current = currentMandate(mandates.data);
  const owner = me.data?.role === 'OWNER';
  return (
    <div className="content">
      <PageHead
        title="Mandate"
        sub="What the agents are allowed to spend, tied to the buyer’s PayPal approval. The policy can only narrow this; nothing can widen it."
        action={
          owner ? (
            <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
              New mandate
            </button>
          ) : undefined
        }
      />
      {mandates.isPending && (
        <Panel flush>
          <TableSkeleton rows={3} />
        </Panel>
      )}
      {mandates.isError && (
        <Panel>
          <ErrorNote error={mandates.error} retry={() => void mandates.refetch()} />
        </Panel>
      )}
      {mandates.data?.length === 0 && (
        <Panel>
          <EmptyState title="No mandate yet">
            Create one to give agents a budget. Until the buyer approves it on PayPal, nothing can
            be spent.
          </EmptyState>
        </Panel>
      )}
      {current && (
        <Panel
          title="Current mandate"
          action={
            <span className="row">
              <StateBadge state={current.status} />
              {owner && current.status !== 'REVOKED' && <RevokeButton id={current.id} />}
            </span>
          }
        >
          <div className="grid-3">
            <div className="stack" style={{ gap: 4 }}>
              <span className="stat-label">Total cap</span>
              <MoneyAmount
                className="stat-value"
                minor={current.capMinor}
                currency={current.currency}
              />
            </div>
            <div className="stack" style={{ gap: 4 }}>
              <span className="stat-label">Per mission</span>
              <MoneyAmount
                className="stat-value"
                minor={current.perMissionCapMinor}
                currency={current.currency}
              />
            </div>
            <div className="stack" style={{ gap: 4 }}>
              <span className="stat-label">Valid</span>
              <span className="stat-value" style={{ fontSize: 15 }}>
                {formatDay(current.validFrom)} → {formatDay(current.validTo)}
              </span>
            </div>
          </div>
          <p className="hint" style={{ marginTop: 14 }}>
            {current.signedAt
              ? `Approved by the buyer on PayPal ${formatDay(current.signedAt)}.`
              : 'Not approved by the buyer yet.'}{' '}
            <SimBadge>fake PayPal</SimBadge> <IdChip id={current.id} />
          </p>
        </Panel>
      )}
      {mandates.data && mandates.data.length > 1 && (
        <Panel title="All mandates" flush>
          <table className="table">
            <thead>
              <tr>
                <th>Mandate</th>
                <th>Status</th>
                <th className="right">Cap</th>
                <th className="right">Valid until</th>
              </tr>
            </thead>
            <tbody>
              {mandates.data.map((m) => (
                <tr key={m.id}>
                  <td>
                    <IdChip id={m.id} />
                  </td>
                  <td>
                    <StateBadge state={m.status} />
                  </td>
                  <td className="right">
                    <MoneyAmount minor={m.capMinor} currency={m.currency} />
                  </td>
                  <td className="right faint">{formatDay(m.validTo)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}
      {!owner && me.isSuccess && (
        <Badge plain>Only an owner changes the mandate. Switch role in the top bar.</Badge>
      )}
      {creating && <NewMandate onClose={() => setCreating(false)} />}
    </div>
  );
}
