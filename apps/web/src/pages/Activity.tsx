import { useState } from 'react';
import { ReceiptDrawer } from '../components/ReceiptDrawer';
import {
  EmptyState,
  ErrorNote,
  IdChip,
  MoneyAmount,
  Panel,
  StateBadge,
  StateLadder,
  TableSkeleton,
} from '../components/ui';
import { humanize, relative } from '../lib/format';
import { useActions } from '../lib/queries';
import type { ActionRow } from '../lib/types';
import { PageHead } from './parts';

/** Actions as a table: type, state ladder, amount. Clicking a row opens its receipt. */
export function ActionsTable({
  rows,
  onOpen,
}: {
  rows: ActionRow[];
  onOpen: (id: string) => void;
}) {
  return (
    <table className="table">
      <thead>
        <tr>
          <th>Action</th>
          <th>State</th>
          <th style={{ width: 120 }}>Progress</th>
          <th className="right">Amount</th>
          <th>By</th>
          <th className="right">When</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((a) => (
          <tr key={a.id} data-click onClick={() => onOpen(a.id)}>
            <td>
              <span className="row" style={{ gap: 8 }}>
                {humanize(a.type)} <IdChip id={a.id} />
              </span>
            </td>
            <td>
              <StateBadge state={a.state} />
            </td>
            <td>
              <StateLadder state={a.state} />
            </td>
            <td className="right">
              <MoneyAmount minor={a.amountMinor} currency={a.currency} />
            </td>
            <td className="muted">{humanize(a.proposedBy)}</td>
            <td className="right faint">{relative(a.createdAt)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function Activity() {
  const actions = useActions();
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className="content">
      <PageHead
        title="Activity"
        sub="Every hold, capture, refund and payout, and where it stands. Open one to read its receipt."
      />
      <Panel flush>
        {actions.isPending && <TableSkeleton />}
        {actions.isError && (
          <ErrorNote error={actions.error} retry={() => void actions.refetch()} />
        )}
        {actions.data?.length === 0 && (
          <EmptyState title="Nothing has happened yet">
            Run the agents on a mission and their proposals will appear here.
          </EmptyState>
        )}
        {actions.data && actions.data.length > 0 && (
          <ActionsTable rows={actions.data} onOpen={setOpen} />
        )}
      </Panel>
      {open && <ReceiptDrawer actionId={open} onClose={() => setOpen(null)} />}
    </div>
  );
}
