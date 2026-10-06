import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
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
import { formatMoney, humanize } from '../lib/format';
import type { LabFix, LabRun, LabScenario } from '../lib/types';
import { PageHead } from './parts';

type PolicyChoice = 'standard' | 'no-velocity';

const family = (name: string) => humanize(name.replaceAll('-', '_'));
/** The lab reports amounts in cents; people read dollars. */
const inDollars = (text: string) =>
  text.replace(/(\d+) cents/g, (_, cents: string) => formatMoney(cents, 'USD'));

function Steps({ scenario }: { scenario: LabScenario }) {
  return (
    <table className="table">
      <thead>
        <tr>
          <th>#</th>
          <th>Supplier</th>
          <th className="right">Each</th>
          <th className="right">Qty</th>
          <th className="right">After</th>
        </tr>
      </thead>
      <tbody>
        {scenario.steps.map((s, i) => (
          <tr key={`${s.supplier}-${i + 1}-${s.unitCents}`}>
            <td className="faint num">{i + 1}</td>
            <td className="mono">{s.supplier}</td>
            <td className="right num">{formatMoney(String(s.unitCents), 'USD')}</td>
            <td className="right num">{s.quantity}</td>
            <td className="right faint num">{s.afterMinutes} min</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Finding({
  policy,
  finding,
}: {
  policy: PolicyChoice;
  finding: LabRun['findings'][number];
}) {
  const fix = useMutation({
    mutationFn: () => api.post<LabFix>('/v1/demo/lab/fix', { policy, scenario: finding.scenario }),
  });
  const [first] = finding.violations;
  const result = fix.data;
  return (
    <Panel
      title={
        <span className="row">
          {family(finding.scenario.family)}{' '}
          <Badge tone="bad">{humanize(first?.invariant ?? 'broken')}</Badge>
        </span>
      }
      action={
        !result && (
          <button
            type="button"
            className="btn btn-sm"
            disabled={fix.isPending}
            onClick={() => fix.mutate()}
          >
            {fix.isPending ? 'Shrinking…' : 'Shrink and fix'}
          </button>
        )
      }
      flush
    >
      <p className="muted" style={{ padding: '12px 14px' }}>
        {inDollars(first?.detail ?? '')} It took {finding.scenario.steps.length} orders.
      </p>
      {fix.isError && <ErrorNote error={fix.error} retry={() => fix.mutate()} />}
      {result && (
        <div style={{ borderTop: '1px solid var(--border)' }}>
          <p className="panel-body">
            Smallest sequence that still breaks it:{' '}
            <strong>{result.minimal.steps.length} orders</strong>. Take any one away and the policy
            holds.
          </p>
          <Steps scenario={result.minimal} />
          <div className="panel-body stack" style={{ borderTop: '1px solid var(--border)' }}>
            <span className="eyebrow">Proposed patch</span>
            <span>{result.patch ?? 'No patch is known for this kind of failure.'}</span>
            {result.patch && (
              <Badge tone={result.cleanAfter ? 'ok' : 'bad'}>
                {result.cleanAfter
                  ? 'Re-run with the patch: no violation'
                  : 'Still breaks with the patch'}
              </Badge>
            )}
          </div>
        </div>
      )}
    </Panel>
  );
}

export function Lab() {
  const [policy, setPolicy] = useState<PolicyChoice>('standard');
  const [count, setCount] = useState(24);
  const run = useMutation({
    mutationFn: () => api.post<LabRun>('/v1/demo/lab/run', { policy, count }),
  });
  const data = run.data;
  return (
    <div className="content">
      <PageHead
        title="Policy lab"
        sub="Tries to get more spending approved than the policy should allow: many orders just under an approval line, split across suppliers, repeated, spread over a day. Each runs through the real decision pipeline."
        action={
          <span className="row">
            <select
              className="select"
              style={{ width: 300 }}
              aria-label="Policy"
              value={policy}
              onChange={(e) => setPolicy(e.target.value as PolicyChoice)}
            >
              <option value="standard">The standard policy</option>
              <option value="no-velocity">Standard, daily limit removed (a seeded hole)</option>
            </select>
            <select
              className="select"
              style={{ width: 120 }}
              aria-label="Scenarios"
              value={count}
              onChange={(e) => setCount(Number(e.target.value))}
            >
              <option value={24}>24 scenarios</option>
              <option value={48}>48 scenarios</option>
            </select>
            <button
              type="button"
              className="btn btn-primary"
              disabled={run.isPending}
              onClick={() => run.mutate()}
            >
              {run.isPending ? 'Running…' : 'Run the lab'}
            </button>
          </span>
        }
      />
      {!data && !run.isPending && !run.isError && (
        <Panel>
          <EmptyState title="Not run yet">
            Run it against the standard policy and nothing should break. Remove the daily limit and
            it finds the hole, shrinks it to the fewest orders that still break it, and proposes the
            fix. <SimBadge>no PayPal calls</SimBadge>
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
            <Stat label="Scenarios">{data.total}</Stat>
            <Stat label="Broke the policy">
              <span style={{ color: data.broken === 0 ? 'var(--ok)' : '#ff7b80' }}>
                {data.broken}
              </span>
            </Stat>
            <Stat label="Families tried">{Object.keys(data.byFamily).length}</Stat>
          </div>
          <Panel flush>
            <table className="table">
              <thead>
                <tr>
                  <th>Family</th>
                  <th className="right">Scenarios</th>
                  <th className="right">Broke the policy</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(data.byFamily).map(([name, n]) => {
                  const broke = data.brokenByFamily[name] ?? 0;
                  return (
                    <tr key={name}>
                      <td>{family(name)}</td>
                      <td className="right num">{n}</td>
                      <td className="right">
                        <Badge tone={broke === 0 ? 'ok' : 'bad'}>
                          {broke === 0 ? 'Held' : `${broke} broke it`}
                        </Badge>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Panel>
          {data.findings.map((f) => (
            <Finding key={f.scenario.id} policy={policy} finding={f} />
          ))}
        </>
      )}
    </div>
  );
}
