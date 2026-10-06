import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  Badge,
  Dialog,
  EmptyState,
  ErrorNote,
  Field,
  IdChip,
  Panel,
  SimBadge,
  StateBadge,
  TableSkeleton,
  useToast,
} from '../components/ui';
import { api } from '../lib/api';
import { formatTime, humanize, relative } from '../lib/format';
import { useIncidents, useMe } from '../lib/queries';
import type { Incident } from '../lib/types';
import { PageHead } from './parts';

const SEVERITY = { LOW: 'neutral', MEDIUM: 'warn', HIGH: 'bad', CRITICAL: 'bad' } as const;

function Resolve({ incident, onClose }: { incident: Incident; onClose: () => void }) {
  const [note, setNote] = useState('');
  const client = useQueryClient();
  const toast = useToast();
  const resolve = useMutation({
    mutationFn: () => api.post(`/v1/incidents/${incident.id}/resolve`, { note }),
    onSuccess: () => {
      toast('ok', 'Resolved.');
      void client.invalidateQueries();
      onClose();
    },
    onError: (e: Error) => toast('bad', (e as { readable?: string }).readable ?? e.message),
  });
  return (
    <Dialog
      title="Resolve this incident"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!note.trim() || resolve.isPending}
            onClick={() => resolve.mutate()}
          >
            Resolve
          </button>
        </>
      }
    >
      <p className="muted">
        Say what you found. Only after an incident is resolved can a frozen mandate be resumed.
      </p>
      <Field label="What did you find?">
        {(id) => (
          <textarea
            id={id}
            className="textarea"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        )}
      </Field>
    </Dialog>
  );
}

function IncidentCard({ incident, canResolve }: { incident: Incident; canResolve: boolean }) {
  const [resolving, setResolving] = useState(false);
  const e = incident.evidence;
  return (
    <Panel
      title={
        <span className="row">
          {humanize(incident.type)}{' '}
          <Badge tone={SEVERITY[incident.severity]}>{humanize(incident.severity)}</Badge>{' '}
          <StateBadge state={incident.status} />
        </span>
      }
      action={
        canResolve && incident.status !== 'RESOLVED' ? (
          <button type="button" className="btn btn-sm" onClick={() => setResolving(true)}>
            Resolve
          </button>
        ) : (
          <span className="faint">{relative(incident.openedAt)}</span>
        )
      }
    >
      <div className="stack">
        {e.why && <p>{e.why}</p>}
        <dl className="dl">
          {e.amount && (
            <>
              <dt>Amount</dt>
              <dd>
                {e.amount.value} {e.amount.currency_code}
              </dd>
            </>
          )}
          {e.eventType && (
            <>
              <dt>PayPal event</dt>
              <dd className="mono">
                {e.eventType} <IdChip id={e.resourceId ?? ''} />
              </dd>
            </>
          )}
          <dt>Opened</dt>
          <dd>
            {formatTime(incident.openedAt)} <IdChip id={incident.id} />
          </dd>
          {incident.resolution?.note && (
            <>
              <dt>Resolution</dt>
              <dd>{incident.resolution.note}</dd>
            </>
          )}
        </dl>
        {incident.autoResponse.length > 0 && (
          <div>
            <h3 className="eyebrow" style={{ marginBottom: 10 }}>
              Automatic response
            </h3>
            <ol className="timeline">
              {incident.autoResponse.map((s) => (
                <li key={`${s.step}-${s.at}`} data-tone="ok">
                  <span>
                    <span className="mono">{s.step}</span>
                  </span>
                  <span className="faint">{formatTime(s.at)}</span>
                </li>
              ))}
            </ol>
          </div>
        )}
      </div>
      {resolving && <Resolve incident={incident} onClose={() => setResolving(false)} />}
    </Panel>
  );
}

export function Incidents() {
  const incidents = useIncidents();
  const me = useMe();
  const client = useQueryClient();
  const toast = useToast();
  const rogue = useMutation({
    mutationFn: () => api.post('/v1/demo/rogue-capture'),
    onSuccess: () => {
      toast('ok', 'PayPal moved $50.00 with no action behind it. Watch the Verifier.');
      setTimeout(() => void client.invalidateQueries(), 1500);
    },
    onError: (e: Error) => toast('bad', (e as { readable?: string }).readable ?? e.message),
  });
  const owner = me.data?.role === 'OWNER';
  return (
    <div className="content">
      <PageHead
        title="Incidents"
        sub="Anything that moved money without an approved action behind it. The Verifier acts at once: it freezes the mandate, voids holds, refunds, and tells the owner."
      />
      {owner && (
        <Panel
          title={
            <span className="row">
              Try the kill switch <SimBadge />
            </span>
          }
          action={
            <button
              type="button"
              className="btn btn-danger"
              disabled={rogue.isPending}
              onClick={() => rogue.mutate()}
            >
              Simulate a rogue capture
            </button>
          }
        >
          <p className="muted">
            Pretend something outside Bursar (a leaked credential, a bug) captures $50.00 straight
            from PayPal. The signed webhook arrives, nothing in the records explains it, and the
            Verifier contains it. This revokes the demo mandate; open a new workspace to start
            again. Do it after approving a purchase and before capturing it, so there is a hold to
            capture.
          </p>
        </Panel>
      )}
      {incidents.isPending && (
        <Panel flush>
          <TableSkeleton rows={3} />
        </Panel>
      )}
      {incidents.isError && (
        <Panel>
          <ErrorNote error={incidents.error} retry={() => void incidents.refetch()} />
        </Panel>
      )}
      {incidents.data?.length === 0 && (
        <Panel>
          <EmptyState title="No incidents">
            Nothing has moved money outside an approved action. If something does, it will appear
            here within seconds.
          </EmptyState>
        </Panel>
      )}
      {incidents.data?.map((i) => (
        <IncidentCard key={i.id} incident={i} canResolve={owner} />
      ))}
    </div>
  );
}
