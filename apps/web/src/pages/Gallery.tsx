import { useState } from 'react';
import {
  Badge,
  Dialog,
  EmptyState,
  Icon,
  IdChip,
  MoneyAmount,
  Panel,
  SimBadge,
  Skeleton,
  StateBadge,
  StateLadder,
  TableSkeleton,
  useToast,
} from '../components/ui';

/** Every primitive in one place, in the product's own surfaces. Reached at /_ui. */
export function Gallery() {
  const [dialog, setDialog] = useState(false);
  const toast = useToast();
  return (
    <div className="content" style={{ margin: '0 auto' }}>
      <h1 className="page-title">Design system</h1>
      <Panel title="Buttons">
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-primary">
            Primary
          </button>
          <button type="button" className="btn">
            Secondary
          </button>
          <button type="button" className="btn btn-ghost">
            Ghost
          </button>
          <button type="button" className="btn btn-danger">
            Danger
          </button>
          <button type="button" className="btn" disabled>
            Disabled
          </button>
        </div>
      </Panel>
      <Panel title="State: badges, ladder, chips, amounts">
        <div className="stack">
          <div className="row" style={{ flexWrap: 'wrap' }}>
            {['CONFIRMED', 'AWAITING_APPROVAL', 'APPROVED', 'DENIED', 'FROZEN', 'REVOKED'].map(
              (s) => (
                <StateBadge key={s} state={s} />
              ),
            )}
            <Badge>Neutral</Badge> <SimBadge />
          </div>
          {['PROPOSED', 'APPROVED', 'SUBMITTED', 'CONFIRMED', 'DENIED', 'FAILED'].map((s) => (
            <div key={s} className="row" style={{ gap: 14 }}>
              <span className="mono faint" style={{ width: 90 }}>
                {s}
              </span>
              <div style={{ width: 160 }}>
                <StateLadder state={s} />
              </div>
            </div>
          ))}
          <div className="row">
            <IdChip id="act_01M4X7Z9QK3V8N2P5R6T" /> <MoneyAmount minor="123456" currency="USD" />{' '}
            <MoneyAmount minor="-500" currency="USD" /> <MoneyAmount minor="1999" currency="JPY" />
          </div>
        </div>
      </Panel>
      <Panel title="Table" flush>
        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>State</th>
              <th className="right">Amount</th>
            </tr>
          </thead>
          <tbody>
            <tr data-click>
              <td>Standing desk</td>
              <td>
                <StateBadge state="CONFIRMED" />
              </td>
              <td className="right">
                <MoneyAmount minor="32000" currency="USD" />
              </td>
            </tr>
            <tr data-click>
              <td>Office chair</td>
              <td>
                <StateBadge state="AWAITING_APPROVAL" />
              </td>
              <td className="right">
                <MoneyAmount minor="14000" currency="USD" />
              </td>
            </tr>
          </tbody>
        </table>
      </Panel>
      <div className="grid-2">
        <Panel title="Loading">
          <div className="stack">
            <Skeleton width="40%" />
            <TableSkeleton rows={2} />
          </div>
        </Panel>
        <Panel title="Empty">
          <EmptyState title="Nothing here yet">What to do about it goes here.</EmptyState>
        </Panel>
      </div>
      <Panel title="Overlays and toasts">
        <div className="row">
          <button type="button" className="btn" onClick={() => setDialog(true)}>
            Open dialog
          </button>
          <button type="button" className="btn" onClick={() => toast('ok', 'Saved.')}>
            Success toast
          </button>
          <button type="button" className="btn" onClick={() => toast('bad', 'That did not work.')}>
            Error toast
          </button>
          <Icon name="shield" />
        </div>
      </Panel>
      {dialog && (
        <Dialog
          title="A dialog"
          onClose={() => setDialog(false)}
          footer={
            <button type="button" className="btn btn-primary" onClick={() => setDialog(false)}>
              Close
            </button>
          }
        >
          <p className="muted">
            Dialogs, drawers and the command palette share one surface and one way of closing:
            Escape.
          </p>
        </Dialog>
      )}
    </div>
  );
}
