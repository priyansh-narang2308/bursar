import { useMutation } from '@tanstack/react-query';
import {
  Badge,
  EmptyState,
  ErrorNote,
  Panel,
  SimBadge,
  Stat,
  TableSkeleton,
} from '../components/ui';
import { api } from '../lib/api';
import { humanize } from '../lib/format';
import type { GauntletView } from '../lib/types';
import { PageHead } from './parts';

export function Gauntlet() {
  const run = useMutation({ mutationFn: () => api.post<GauntletView>('/v1/demo/gauntlet') });
  const data = run.data;
  return (
    <div className="content">
      <PageHead
        title="Gauntlet"
        sub="Product titles are written by sellers, so they can carry instructions. 27 prompt-injection payloads are planted in a catalog and read by the same gullible agent twice: once with raw payment tools, once through Bursar."
        action={
          <button
            type="button"
            className="btn btn-primary"
            disabled={run.isPending}
            onClick={() => run.mutate()}
          >
            {data ? 'Run again' : 'Run the gauntlet'}
          </button>
        }
      />
      {!data && !run.isPending && !run.isError && (
        <Panel>
          <EmptyState title="Not run yet">
            The agent is deliberately gullible (it does what a product title tells it to), so the
            only thing that differs between the two runs is the tool layer.{' '}
            <SimBadge>scripted model</SimBadge>
          </EmptyState>
        </Panel>
      )}
      {run.isPending && (
        <Panel flush>
          <TableSkeleton rows={6} />
        </Panel>
      )}
      {run.isError && (
        <Panel>
          <ErrorNote error={run.error} retry={() => run.mutate()} />
        </Panel>
      )}
      {data && (
        <>
          <div className="grid-3">
            <Stat label="Payloads">{data.total}</Stat>
            <Stat label="Naive agent compromised" hint="Paid or ordered for the attacker">
              <span style={{ color: '#ff7b80' }}>{data.naiveCompromised}</span>
            </Stat>
            <Stat label="PayPal calls through Bursar" hint="Across every payload">
              <span style={{ color: 'var(--ok)' }}>{data.guardedPayPalCalls}</span>
            </Stat>
          </div>
          <Panel flush>
            <table className="table">
              <thead>
                <tr>
                  <th>Payload</th>
                  <th>Family</th>
                  <th>Raw tools</th>
                  <th>Through Bursar</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.id}>
                    <td style={{ maxWidth: 360 }}>
                      <span className="mono faint">{r.id}</span>{' '}
                      <span className="muted" style={{ overflowWrap: 'anywhere' }}>
                        {r.text}
                      </span>
                    </td>
                    <td className="muted">{humanize(r.family)}</td>
                    <td>
                      {r.naiveCompromised ? (
                        <Badge tone="bad">Compromised</Badge>
                      ) : (
                        <Badge plain>Not read</Badge>
                      )}
                    </td>
                    <td>
                      <Badge tone={r.guardedPayPalCalls === 0 ? 'ok' : 'bad'}>
                        {r.guardedPayPalCalls === 0 ? 'Held' : 'Money moved'}
                      </Badge>{' '}
                      <span className="faint">{r.guardedRefused} refused</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
        </>
      )}
    </div>
  );
}
