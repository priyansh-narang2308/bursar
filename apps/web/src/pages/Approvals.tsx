import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ReceiptDrawer } from '../components/ReceiptDrawer';
import {
  Badge,
  EmptyState,
  ErrorNote,
  IdChip,
  MoneyAmount,
  Panel,
  TableSkeleton,
  useToast,
} from '../components/ui';
import { api } from '../lib/api';
import { humanize, relative } from '../lib/format';
import { useApprovals, useMe } from '../lib/queries';
import { PageHead } from './parts';

export function Approvals() {
  const me = useMe();
  const canDecide = me.data?.role === 'OWNER' || me.data?.role === 'APPROVER';
  const approvals = useApprovals(canDecide);
  const [open, setOpen] = useState<string | null>(null);
  const client = useQueryClient();
  const toast = useToast();
  const decide = useMutation({
    mutationFn: ({ id, decision }: { id: string; decision: 'APPROVE' | 'REJECT' }) =>
      api.post<{ state: string; execution?: { outcome: string } }>(`/v1/approvals/${id}/decide`, {
        decision,
      }),
    onSuccess: (result, { decision }) => {
      toast(
        'ok',
        decision === 'APPROVE'
          ? `Approved. ${result.execution ? `PayPal: ${result.execution.outcome}.` : ''}`
          : 'Rejected. Nothing will be spent.',
      );
      void client.invalidateQueries();
    },
    onError: (e: Error) => toast('bad', (e as { readable?: string }).readable ?? e.message),
  });
  return (
    <div className="content">
      <PageHead
        title="Approvals"
        sub="Proposals the policy would not approve on its own. A person decides; the approval is signed over the exact cart and policy."
      />
      {!canDecide && me.isSuccess && (
        <div className="callout callout-warn">
          You are viewing as {humanize(me.data.role).toLowerCase()}, who cannot decide approvals.
          Switch to Owner or Approver in the top bar.
        </div>
      )}
      <Panel flush>
        {canDecide && approvals.isPending && <TableSkeleton />}
        {approvals.isError && (
          <ErrorNote error={approvals.error} retry={() => void approvals.refetch()} />
        )}
        {canDecide && approvals.data?.length === 0 && (
          <EmptyState title="Nothing is waiting">
            Run the agents on a mission, and their first purchase from a new supplier will wait here
            for you.
          </EmptyState>
        )}
        {approvals.data && approvals.data.length > 0 && (
          <table className="table">
            <thead>
              <tr>
                <th>Proposal</th>
                <th className="right">Amount</th>
                <th>By</th>
                <th>Expires</th>
                <th className="right">Decision</th>
              </tr>
            </thead>
            <tbody>
              {approvals.data.map((a) => (
                <tr key={a.id} data-click onClick={() => setOpen(a.actionId)}>
                  <td>
                    <span className="row" style={{ gap: 8 }}>
                      {humanize(a.type)} <IdChip id={a.actionId} />
                    </span>
                  </td>
                  <td className="right">
                    <MoneyAmount minor={a.amountMinor} currency={a.currency} />
                  </td>
                  <td className="muted">{humanize(a.proposedBy)}</td>
                  <td>
                    <Badge tone="warn" plain>
                      {relative(a.expiresAt)}
                    </Badge>
                  </td>
                  <td className="right">
                    <span className="row" style={{ justifyContent: 'flex-end', gap: 6 }}>
                      <button
                        type="button"
                        className="btn btn-sm"
                        disabled={decide.isPending}
                        onClick={(e) => {
                          e.stopPropagation();
                          decide.mutate({ id: a.id, decision: 'REJECT' });
                        }}
                      >
                        Reject
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm btn-primary"
                        disabled={decide.isPending}
                        onClick={(e) => {
                          e.stopPropagation();
                          decide.mutate({ id: a.id, decision: 'APPROVE' });
                        }}
                      >
                        Approve
                      </button>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
      {open && <ReceiptDrawer actionId={open} onClose={() => setOpen(null)} />}
    </div>
  );
}
