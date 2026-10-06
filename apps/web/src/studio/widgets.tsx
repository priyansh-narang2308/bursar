import type { Cockpit } from '@bursar/schemas';
import type { AgWidgetParams } from 'ag-studio';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { Badge } from '../components/ui';
import { api } from '../lib/api';
import { formatMoney, formatTime } from '../lib/format';
import type { LabRun } from '../lib/types';
import { cockpitStore, useCockpitStore } from './store';

/*
 * The six widgets Bursar adds to Studio. Each draws what the server worked out (`GET /v1/cockpit`), shows
 * Studio's display states, and joins the cross-filter: pick a rule in one and the others narrow to it.
 * They are plain React and use no router or query context, because Studio mounts them in its own tree.
 */

type Tone = 'ok' | 'warn' | 'bad' | 'neutral';
const OUTCOME_TONE: Record<string, Tone> = { ALLOW: 'ok', REQUIRE_APPROVAL: 'warn', DENY: 'bad' };
const OUTCOME_LABEL: Record<string, string> = {
  ALLOW: 'Allow',
  REQUIRE_APPROVAL: 'Approve',
  DENY: 'Deny',
};

/** Tells Studio what to show around the widget: its own loading and empty states, or the widget itself. */
function useDisplayState(params: AgWidgetParams, ready: boolean, empty: boolean) {
  useEffect(() => {
    params.widgetApi.setDisplayState(!ready ? 'loading' : empty ? 'noData' : 'displayed');
  }, [params.widgetApi, ready, empty]);
}

function Frame({ children }: { children: ReactNode }) {
  return <div className="sw">{children}</div>;
}

function RuleFilterNote() {
  const { rule } = useCockpitStore();
  if (rule === null) return null;
  return (
    <button type="button" className="sw-filter" onClick={cockpitStore.clearRule}>
      Narrowed to {rule} <span aria-hidden="true">x</span>
      <span className="sr-only">Clear the rule filter</span>
    </button>
  );
}

// ---------------------------------------------------------------------------------------------------
// 1. Envelope gauge: how much of the mission ceiling is held or captured
// ---------------------------------------------------------------------------------------------------

const ARC = Math.PI * 80;
const toneOfUse = (percent: number): Tone =>
  percent >= 90 ? 'bad' : percent >= 70 ? 'warn' : 'ok';

export function EnvelopeGauge(params: AgWidgetParams) {
  const { cockpit } = useCockpitStore();
  const envelope = cockpit?.envelopes[0];
  useDisplayState(params, cockpit !== null, envelope === undefined);
  if (envelope === undefined) return null;
  const tone = toneOfUse(envelope.usedPercent);
  return (
    <Frame>
      <svg
        viewBox="0 0 200 118"
        className="sw-gauge"
        role="img"
        aria-label={`${envelope.usedPercent} percent of the ceiling is in use`}
      >
        <path d="M 20 100 A 80 80 0 0 1 180 100" className="sw-gauge-track" />
        <path
          d="M 20 100 A 80 80 0 0 1 180 100"
          className="sw-gauge-fill"
          data-tone={tone}
          strokeDasharray={`${(envelope.usedPercent / 100) * ARC} ${ARC}`}
        />
        <text x="100" y="92" textAnchor="middle" className="sw-gauge-value">
          {envelope.usedPercent}%
        </text>
        <text x="100" y="112" textAnchor="middle" className="sw-gauge-label">
          of the ceiling in use
        </text>
      </svg>
      <dl className="sw-kv">
        <dt>Ceiling</dt>
        <dd>{formatMoney(envelope.ceiling.minor, envelope.ceiling.currency)}</dd>
        <dt>Held</dt>
        <dd>{formatMoney(envelope.held.minor, envelope.held.currency)}</dd>
        <dt>Captured</dt>
        <dd>{formatMoney(envelope.captured.minor, envelope.captured.currency)}</dd>
        <dt>Refunded</dt>
        <dd>{formatMoney(envelope.refunded.minor, envelope.refunded.currency)}</dd>
      </dl>
    </Frame>
  );
}

// ---------------------------------------------------------------------------------------------------
// 2. Decision stream: the latest rulings, narrowed by the picked rule
// ---------------------------------------------------------------------------------------------------

export function DecisionStream(params: AgWidgetParams) {
  const { cockpit, rule } = useCockpitStore();
  const rows = useMemo(
    () =>
      (cockpit?.decisions ?? [])
        .filter(
          (d) => rule === null || d.rules.some((r) => r.rule === rule && r.outcome !== 'ALLOW'),
        )
        .slice(0, 12),
    [cockpit, rule],
  );
  useDisplayState(params, cockpit !== null, rows.length === 0);
  return (
    <Frame>
      <RuleFilterNote />
      <ol className="sw-list">
        {rows.map((d) => {
          const flagged = d.rules.filter((r) => r.outcome !== 'ALLOW');
          return (
            <li key={d.id}>
              <Badge tone={OUTCOME_TONE[d.outcome] ?? 'neutral'}>
                {OUTCOME_LABEL[d.outcome] ?? d.outcome}
              </Badge>
              <span className="sw-main">
                {d.type.toLowerCase()}
                <span className="sw-sub">
                  {d.amount === null ? 'no amount' : formatMoney(d.amount.minor, d.amount.currency)}{' '}
                  · {formatTime(d.evaluatedAt)}
                </span>
              </span>
              <span className="sw-chips">
                {flagged.slice(0, 3).map((r) => (
                  <button
                    key={r.rule}
                    type="button"
                    className="sw-chip"
                    data-on={rule === r.rule}
                    title={r.message}
                    onClick={() => cockpitStore.toggleRule(r.rule)}
                  >
                    {r.rule}
                  </button>
                ))}
              </span>
            </li>
          );
        })}
      </ol>
    </Frame>
  );
}

// ---------------------------------------------------------------------------------------------------
// 3. Rule heatmap: which rules fire, and with what outcome
// ---------------------------------------------------------------------------------------------------

const OUTCOMES = ['ALLOW', 'REQUIRE_APPROVAL', 'DENY'] as const;

export function RuleHeatmap(params: AgWidgetParams) {
  const { cockpit, rule } = useCockpitStore();
  const grid = useMemo(() => {
    const rules = new Map<string, Record<string, number>>();
    for (const hit of cockpit?.ruleHits ?? [])
      rules.set(hit.rule, { ...rules.get(hit.rule), [hit.outcome]: hit.count });
    const peak = Math.max(1, ...(cockpit?.ruleHits.map((h) => h.count) ?? [1]));
    return { rules: [...rules].sort(([a], [b]) => a.localeCompare(b)), peak };
  }, [cockpit]);
  useDisplayState(params, cockpit !== null, grid.rules.length === 0);
  return (
    <Frame>
      <table className="sw-heat">
        <caption className="sr-only">How often each rule fired, by outcome</caption>
        <thead>
          <tr>
            <th scope="col">Rule</th>
            {OUTCOMES.map((o) => (
              <th key={o} scope="col">
                {OUTCOME_LABEL[o]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {grid.rules.map(([name, counts]) => (
            <tr key={name} data-on={rule === name}>
              <th scope="row">
                <button type="button" onClick={() => cockpitStore.toggleRule(name)}>
                  {name}
                </button>
              </th>
              {OUTCOMES.map((o) => {
                const count = counts[o] ?? 0;
                return (
                  <td
                    key={o}
                    data-tone={OUTCOME_TONE[o]}
                    data-level={
                      count === 0 ? 0 : Math.min(4, 1 + Math.floor((count / grid.peak) * 3))
                    }
                  >
                    {count === 0 ? '' : count}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </Frame>
  );
}

// ---------------------------------------------------------------------------------------------------
// 4. Money flow: where the mandate's money went
// ---------------------------------------------------------------------------------------------------

const COLUMNS: Record<string, number> = {
  Mandate: 0,
  Held: 1,
  Captured: 1,
  Refunded: 2,
  Settled: 2,
};

export function MoneyFlowSankey(params: AgWidgetParams) {
  const { cockpit } = useCockpitStore();
  const flows = cockpit?.flows ?? [];
  const layout = useMemo(() => sankey(flows), [flows]);
  useDisplayState(params, cockpit !== null, flows.length === 0);
  return (
    <Frame>
      <svg viewBox="0 0 400 200" className="sw-sankey" role="img" aria-label="Where the money went">
        {layout.links.map((l) => (
          <path
            key={`${l.from}-${l.to}`}
            d={l.path}
            strokeWidth={l.width}
            className="sw-link"
            data-to={l.to}
          />
        ))}
        {layout.nodes.map((n) => (
          <g key={n.name}>
            <rect x={n.x} y={n.y} width="10" height={n.h} className="sw-node" />
            <text
              x={n.x + (n.col === 2 ? -6 : 16)}
              y={n.y + n.h / 2}
              textAnchor={n.col === 2 ? 'end' : 'start'}
              className="sw-node-label"
            >
              {n.name}
            </text>
          </g>
        ))}
      </svg>
      <ul className="sw-legend">
        {flows.map((f) => (
          <li key={`${f.from}-${f.to}`}>
            {f.from} to {f.to}
            <span>{formatMoney(f.amount.minor, f.amount.currency)}</span>
          </li>
        ))}
      </ul>
    </Frame>
  );
}

type Flow = Cockpit['flows'][number];
interface Node {
  name: string;
  col: number;
  x: number;
  y: number;
  h: number;
}

/** Lays the bands out by their weights. Weights shape the picture; they are not amounts. */
export function sankey(flows: readonly Flow[]) {
  const height = 180;
  const gap = 10;
  const names = [...new Set(flows.flatMap((f) => [f.from, f.to]))];
  const through = (name: string) =>
    Math.max(
      flows.filter((f) => f.to === name).reduce((sum, f) => sum + f.weight, 0),
      flows.filter((f) => f.from === name).reduce((sum, f) => sum + f.weight, 0),
    );
  const columnTotals = [0, 1, 2].map((col) =>
    names.filter((n) => (COLUMNS[n] ?? 1) === col).reduce((sum, n) => sum + through(n), 0),
  );
  const scale = Math.min(
    ...[0, 1, 2].map((col) => {
      const count = names.filter((n) => (COLUMNS[n] ?? 1) === col).length;
      return columnTotals[col] === 0
        ? Number.POSITIVE_INFINITY
        : (height - gap * Math.max(0, count - 1)) / (columnTotals[col] ?? 1);
    }),
  );
  const nodes: Node[] = [];
  const cursor = [10, 10, 10];
  for (const name of names) {
    const col = COLUMNS[name] ?? 1;
    const h = Math.max(6, through(name) * scale);
    nodes.push({ name, col, x: [0, 195, 390][col] ?? 195, y: cursor[col] ?? 10, h });
    cursor[col] = (cursor[col] ?? 10) + h + gap;
  }
  const out = new Map<string, number>();
  const into = new Map<string, number>();
  const links = flows.map((f) => {
    const a = nodes.find((n) => n.name === f.from);
    const b = nodes.find((n) => n.name === f.to);
    const width = Math.max(2, f.weight * scale);
    const ay = (a?.y ?? 0) + (out.get(f.from) ?? 0) + width / 2;
    const by = (b?.y ?? 0) + (into.get(f.to) ?? 0) + width / 2;
    out.set(f.from, (out.get(f.from) ?? 0) + width);
    into.set(f.to, (into.get(f.to) ?? 0) + width);
    const x1 = (a?.x ?? 0) + 10;
    const x2 = b?.x ?? 0;
    const mid = (x1 + x2) / 2;
    return {
      from: f.from,
      to: f.to,
      width,
      path: `M ${x1} ${ay} C ${mid} ${ay}, ${mid} ${by}, ${x2} ${by}`,
    };
  });
  return { nodes, links };
}

// ---------------------------------------------------------------------------------------------------
// 5. Verification status: does PayPal's record explain the money?
// ---------------------------------------------------------------------------------------------------

export function VerificationStatus(params: AgWidgetParams) {
  const { cockpit } = useCockpitStore();
  const v = cockpit?.verification;
  const total = v === undefined ? 0 : v.confirmed + v.waiting + v.unexplained;
  useDisplayState(params, cockpit !== null, total === 0);
  if (v === undefined) return null;
  const parts: Array<[string, number, Tone]> = [
    ['Confirmed', v.confirmed, 'ok'],
    ['Waiting for PayPal', v.waiting, 'warn'],
    ['Unexplained', v.unexplained, v.unexplained > 0 ? 'bad' : 'neutral'],
  ];
  return (
    <Frame>
      <div className="sw-bar" role="img" aria-label="Share of actions by verification status">
        {parts.map(([label, count, tone]) => (
          <i key={label} data-tone={tone} style={{ flexGrow: count }} />
        ))}
      </div>
      <dl className="sw-counts">
        {parts.map(([label, count, tone]) => (
          <div key={label}>
            <dt>
              <span className="sw-dot" data-tone={tone} /> {label}
            </dt>
            <dd className="num">{count}</dd>
          </div>
        ))}
      </dl>
      <p className="sw-sub">
        {v.unexplained === 0
          ? 'Every movement of money is explained by an approved action.'
          : 'Money moved that no approved action explains. The mandate is frozen.'}
      </p>
    </Frame>
  );
}

// ---------------------------------------------------------------------------------------------------
// 6. Lab scorecard: the policy against an adversary
// ---------------------------------------------------------------------------------------------------

type LabState =
  | { status: 'idle' }
  | { status: 'running' }
  | { status: 'failed' }
  | { status: 'done'; run: LabRun };

export function LabScorecard(params: AgWidgetParams) {
  const [state, setState] = useState<LabState>({ status: 'idle' });
  useDisplayState(params, true, false);
  const run = () => {
    setState({ status: 'running' });
    api
      .post<LabRun>('/v1/demo/lab/run', { policy: 'standard', count: 24 })
      .then((result) => setState({ status: 'done', run: result }))
      .catch(() => setState({ status: 'failed' }));
  };
  return (
    <Frame>
      {state.status === 'done' ? (
        <>
          <div className="sw-score">
            <span className="num">{state.run.total}</span>
            <span className="sw-sub">attacks tried</span>
            <span className="num" data-tone={state.run.broken === 0 ? 'ok' : 'bad'}>
              {state.run.broken}
            </span>
            <span className="sw-sub">got through</span>
          </div>
          <ul className="sw-legend">
            {Object.entries(state.run.byFamily).map(([family, count]) => (
              <li key={family}>
                {family.replaceAll('-', ' ')}
                <span>
                  {state.run.brokenByFamily[family] ?? 0} of {count}
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="sw-sub">
          Tries to get more spending approved than the policy should allow. No PayPal calls are
          made.
        </p>
      )}
      {state.status === 'failed' && <p className="sw-sub">The lab could not run.</p>}
      <button type="button" className="btn" disabled={state.status === 'running'} onClick={run}>
        {state.status === 'running'
          ? 'Running…'
          : state.status === 'done'
            ? 'Run again'
            : 'Run the lab'}
      </button>
    </Frame>
  );
}
