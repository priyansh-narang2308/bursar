import { useState } from 'react';
import { Link } from 'react-router-dom';
import { RECEIPT_SEEN_KEY, ReceiptDrawer } from '../components/ReceiptDrawer';
import { Icon, MoneyAmount, Panel, Stat, StateBadge, TableSkeleton } from '../components/ui';
import {
  currentMandate,
  useActions,
  useApprovals,
  useAuditVerdict,
  useMandates,
  useMissions,
} from '../lib/queries';
import { ActionsTable } from './Activity';
import { PageHead } from './parts';

function receiptSeen(): boolean {
  try {
    return localStorage.getItem(RECEIPT_SEEN_KEY) === '1';
  } catch {
    return false;
  }
}

/** A short path through the product for someone who has never seen it. Each step ticks itself off. */
function Tour({
  missionId,
  hasActions,
  confirmed,
}: {
  missionId: string | undefined;
  hasActions: boolean;
  confirmed: boolean;
}) {
  const steps = [
    {
      done: hasActions,
      title: 'Run the agents on the sample mission',
      text: 'They plan, search a catalog and propose one cart. Watch the trace.',
      to: missionId ? `/dashboard/missions/${missionId}` : '/dashboard/missions',
      cta: 'Open mission',
    },
    {
      done: confirmed,
      title: 'Approve the purchase',
      text: 'A first order from a new supplier needs a person. Your approval is signed over the exact cart.',
      to: '/dashboard/approvals',
      cta: 'Open approvals',
    },
    {
      done: receiptSeen(),
      title: 'Read the receipt',
      text: 'Every rule that ran, what was sent to PayPal, and the tamper-evident trail. Try Replay.',
      to: '/dashboard/activity',
      cta: 'Open activity',
    },
  ];
  return (
    <Panel title="Try it in three steps" flush>
      <div className="tour">
        {steps.map((s) => (
          <div key={s.title} className="tour-step">
            <span className="tick" data-done={s.done}>
              <Icon name="check" size={12} />
            </span>
            <span className="stack" style={{ gap: 2 }}>
              <strong>{s.title}</strong>
              <span className="muted">{s.text}</span>
            </span>
            <Link to={s.to} className="btn btn-sm">
              {s.cta}
            </Link>
          </div>
        ))}
      </div>
    </Panel>
  );
}

export function Overview() {
  const mandates = useMandates();
  const missions = useMissions();
  const actions = useActions();
  const approvals = useApprovals();
  const audit = useAuditVerdict();
  const [open, setOpen] = useState<string | null>(null);
  const mandate = currentMandate(mandates.data);
  const recent = actions.data?.slice(0, 6);
  return (
    <div className="content">
      <PageHead
        title="Overview"
        sub="Agents propose, the policy decides, PayPal confirms, and everything is on the record."
      />
      <Tour
        missionId={missions.data?.[0]?.id}
        hasActions={(actions.data?.length ?? 0) > 0}
        confirmed={actions.data?.some((a) => a.state === 'CONFIRMED') ?? false}
      />
      <div className="grid-4">
        <Stat label="Mandate" hint={mandate ? 'Total cap' : 'None yet'}>
          {mandate ? <StateBadge state={mandate.status} /> : '—'}
        </Stat>
        <Stat label="Spending limit">
          {mandate ? <MoneyAmount minor={mandate.capMinor} currency={mandate.currency} /> : '—'}
        </Stat>
        <Stat label="Waiting for approval" hint="Proposals needing a person">
          {approvals.data?.length ?? '—'}
        </Stat>
        <Stat
          label="Audit chain"
          hint={audit.data?.ok ? `${audit.data.count ?? ''} events, unbroken` : 'Not verified'}
        >
          {audit.data ? (audit.data.ok ? 'Verified' : 'Broken') : '—'}
        </Stat>
      </div>
      <Panel
        title="Recent activity"
        action={
          <Link to="/dashboard/activity" className="btn btn-ghost btn-sm">
            View all
          </Link>
        }
        flush
      >
        {actions.isPending && <TableSkeleton rows={3} />}
        {recent?.length === 0 && (
          <p className="muted" style={{ padding: 14 }}>
            Nothing yet. Start with step 1 above.
          </p>
        )}
        {recent && recent.length > 0 && <ActionsTable rows={recent} onOpen={setOpen} />}
      </Panel>
      {open && <ReceiptDrawer actionId={open} onClose={() => setOpen(null)} />}
    </div>
  );
}
