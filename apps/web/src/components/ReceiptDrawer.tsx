import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { formatTime, humanize } from '../lib/format';
import { useReceipt } from '../lib/queries';
import type { Receipt } from '../lib/types';
import {
  Badge,
  Drawer,
  ErrorNote,
  IdChip,
  MoneyAmount,
  Skeleton,
  StateBadge,
  StateLadder,
  toneOf,
  useToast,
} from './ui';

export const RECEIPT_SEEN_KEY = 'bursar.receipt-opened';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="stack" style={{ gap: 8 }}>
      <h3 className="eyebrow">{title}</h3>
      {children}
    </section>
  );
}

function Decisions({ decisions }: { decisions: Receipt['decisions'] }) {
  const toast = useToast();
  const replay = useMutation({
    mutationFn: (id: string) =>
      api.post<{ reproduced: boolean; reason: string }>(`/v1/decisions/${id}/replay`),
    onSuccess: (r) =>
      toast(
        r.reproduced ? 'ok' : 'bad',
        r.reproduced ? 'Replayed: the same outcome, trace and hashes.' : r.reason,
      ),
    onError: (e: Error) => toast('bad', e.message),
  });
  return (
    <Section title="Policy rulings">
      {decisions.map((d) => (
        <div key={d.id} className="panel">
          <div className="panel-head">
            <span className="row">
              <Badge tone={toneOf(d.outcome)}>{humanize(d.outcome)}</Badge>
              <span className="muted">{humanize(d.phase)}</span>
            </span>
            <button
              type="button"
              className="btn btn-sm"
              disabled={replay.isPending}
              onClick={() => replay.mutate(d.id)}
            >
              Replay
            </button>
          </div>
          <table className="table">
            <tbody>
              {d.trace
                .filter((t) => t.outcome !== 'NOT_APPLICABLE')
                .map((t) => (
                  <tr key={t.rule}>
                    <td className="mono" style={{ width: 120 }}>
                      {t.rule}
                    </td>
                    <td className="muted">{t.message}</td>
                    <td className="right">
                      <Badge tone={toneOf(t.outcome)} plain>
                        {humanize(t.outcome)}
                      </Badge>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
          <div className="panel-body row" style={{ gap: 8 }}>
            <span className="faint">policy</span> <IdChip id={d.policyHash} />
            <span className="faint">inputs</span> <IdChip id={d.inputsHash} />
          </div>
        </div>
      ))}
    </Section>
  );
}

function Body({ receipt }: { receipt: Receipt }) {
  const client = useQueryClient();
  const toast = useToast();
  const capture = useMutation({
    mutationFn: () =>
      api.post('/v1/actions', {
        type: 'CAPTURE',
        missionId: receipt.action.missionId,
        cartId: receipt.cart?.id,
      }),
    onSuccess: () => {
      toast('ok', 'Capture proposed. PayPal confirms it with a signed webhook.');
      void client.invalidateQueries();
    },
    onError: (e: Error) => toast('bad', (e as { readable?: string }).readable ?? e.message),
  });
  const { action, cart } = receipt;
  const canCapture =
    action.type === 'AUTHORIZE' &&
    action.state === 'CONFIRMED' &&
    cart !== null &&
    action.missionId !== null;
  return (
    <>
      <div className="stack" style={{ gap: 10 }}>
        <div className="row-between">
          <MoneyAmount
            minor={action.amountMinor}
            currency={action.currency}
            className="stat-value"
          />
          <StateBadge state={action.state} />
        </div>
        <StateLadder state={action.state} />
        <dl className="dl">
          <dt>Action</dt>
          <dd>
            {humanize(action.type)} · <IdChip id={action.id} />
          </dd>
          <dt>Proposed by</dt>
          <dd>
            {humanize(action.proposedBy)} · {formatTime(action.createdAt)}
          </dd>
        </dl>
        {canCapture && (
          <div>
            <button
              type="button"
              className="btn btn-primary"
              disabled={capture.isPending}
              onClick={() => capture.mutate()}
            >
              Capture payment
            </button>
          </div>
        )}
      </div>

      {cart && (
        <Section title={`Cart v${cart.version}`}>
          <div className="panel">
            <table className="table">
              <tbody>
                {cart.lines.map((l) => (
                  <tr key={`${l.title}-${l.quantity}`}>
                    <td>{l.title}</td>
                    <td className="faint">× {l.quantity}</td>
                    <td className="right">
                      <MoneyAmount minor={l.lineTotalMinor} currency={action.currency} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="panel-body row" style={{ gap: 8 }}>
              <span className="faint">hash</span> <IdChip id={cart.hash} />
            </div>
          </div>
        </Section>
      )}

      <Decisions decisions={receipt.decisions} />

      {receipt.approvals.length > 0 && (
        <Section title="Approvals">
          <ul className="timeline">
            {receipt.approvals.map((a) => (
              <li key={a.id} data-tone={toneOf(a.status)}>
                <span>
                  <StateBadge state={a.status} /> {a.signed && <Badge plain>Signed</Badge>}
                </span>
                <span className="faint">
                  {a.decidedAt ? formatTime(a.decidedAt) : `Expires ${formatTime(a.expiresAt)}`}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {receipt.executions.length > 0 && (
        <Section title="Sent to PayPal">
          <ul className="timeline">
            {receipt.executions.map((e) => (
              <li key={e.requestId} data-tone={toneOf(e.status)}>
                <span>
                  <span className="mono">{e.step}</span> <StateBadge state={e.status} />
                </span>
                <span className="faint">
                  request <IdChip id={e.requestId} />
                  {e.debugId && (
                    <>
                      {' '}
                      · debug <IdChip id={e.debugId} />
                    </>
                  )}
                </span>
              </li>
            ))}
            {receipt.paypalEvents.map((e) => (
              <li
                key={`${e.eventType}-${e.receivedAt}`}
                data-tone={e.matchStatus === 'MATCHED' ? 'ok' : 'warn'}
              >
                <span>
                  <span className="mono">{e.eventType}</span>{' '}
                  <Badge plain tone={e.matchStatus === 'MATCHED' ? 'ok' : 'warn'}>
                    {humanize(e.matchStatus)}
                  </Badge>
                </span>
                <span className="faint">webhook · {formatTime(e.receivedAt)}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {receipt.ledger.length > 0 && (
        <Section title="Ledger">
          <div className="panel">
            <table className="table">
              <tbody>
                {receipt.ledger.map((l, i) => (
                  <tr key={`${l.account}-${l.side}-${i + 1}`}>
                    <td className="mono">{l.account}</td>
                    <td className="faint">{l.side.toLowerCase()}</td>
                    <td className="right">
                      <MoneyAmount minor={l.amountMinor} currency={l.currency} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      <Section title="Audit trail">
        <div className="panel">
          <table className="table">
            <tbody>
              {receipt.audit.map((e) => (
                <tr key={e.seq}>
                  <td className="faint num" style={{ width: 40 }}>
                    #{e.seq}
                  </td>
                  <td className="mono">{e.type}</td>
                  <td className="right">
                    <IdChip id={e.hash} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </>
  );
}

/** Everything that happened to one action, from the records themselves. */
export function ReceiptDrawer({ actionId, onClose }: { actionId: string; onClose: () => void }) {
  const receipt = useReceipt(actionId);
  const [, setSeen] = useState(false);
  useEffect(() => {
    try {
      localStorage.setItem(RECEIPT_SEEN_KEY, '1');
    } catch {
      // Storage can be blocked; the tour just will not tick this step.
    }
    setSeen(true);
  }, []);
  return (
    <Drawer title="Receipt" onClose={onClose}>
      {receipt.isPending && (
        <div className="stack">
          <Skeleton width="40%" />
          <Skeleton />
          <Skeleton width="70%" />
        </div>
      )}
      {receipt.isError && <ErrorNote error={receipt.error} retry={() => void receipt.refetch()} />}
      {receipt.data && <Body receipt={receipt.data} />}
    </Drawer>
  );
}
