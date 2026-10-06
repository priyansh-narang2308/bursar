import type { Cockpit } from '@bursar/schemas';
import type { AgDataSourcesDefinition, AgReportState } from 'ag-studio';
import { formatMoney } from '../lib/format';
import type { BursarRegistry } from './registry';

/*
 * What Studio's own widgets (charts, grids) draw. These tables hold no amounts to add up: money is shown as a
 * label the server's figures were formatted into, and the sums live in the cockpit the server sent.
 */
const text = (...ids: string[]) => ids.map((id) => ({ id, format: 'textFormat' as const }));

/** Fields are declared, not inferred, so a table with no rows yet (no incidents) still has a shape. */
const FIELDS = {
  decisions: [
    ...text('decision', 'action', 'kind', 'state', 'outcome', 'amount', 'at'),
    { id: 'approvalsNeeded', format: 'integerFormat' as const },
  ],
  rules: text('decision', 'rule', 'outcome', 'message', 'at'),
  incidents: text('incident', 'kind', 'severity', 'status', 'openedAt'),
};

export function toSources(cockpit: Cockpit): AgDataSourcesDefinition<BursarRegistry> {
  return {
    sources: [
      {
        id: 'decisions',
        fields: FIELDS.decisions,
        data: cockpit.decisions.map((d) => ({
          decision: d.id,
          action: d.actionId,
          kind: d.type,
          state: d.state,
          outcome: d.outcome,
          approvalsNeeded: d.requiredApprovals,
          amount: d.amount === null ? 'none' : formatMoney(d.amount.minor, d.amount.currency),
          at: d.evaluatedAt,
        })),
      },
      {
        id: 'rules',
        fields: FIELDS.rules,
        data: cockpit.decisions.flatMap((d) =>
          d.rules.map((r) => ({
            decision: d.id,
            rule: r.rule,
            outcome: r.outcome,
            message: r.message,
            at: d.evaluatedAt,
          })),
        ),
      },
      {
        id: 'incidents',
        fields: FIELDS.incidents,
        data: cockpit.incidents.map((i) => ({
          incident: i.id,
          kind: i.type,
          severity: i.severity,
          status: i.status,
          openedAt: i.openedAt,
        })),
      },
    ],
  };
}

const place = (id: string, x: number, y: number, w: number, h: number) => ({
  [id]: { xTrack: x, yTrack: y, xSpan: w, ySpan: h },
});

/** The cockpit as it first opens: custom widgets for the story, Studio's own for the tables and charts. */
export const DEFAULT_STATE = {
  pages: [
    {
      id: 'cockpit',
      widgets: {
        envelope: { type: 'envelope-gauge' },
        verification: { type: 'verification-status' },
        outcomes: {
          type: 'donut-chart',
          format: { title: { text: 'Rulings by outcome', enabled: true } },
          dataMapping: {
            categoryKey: [{ id: 'decisions.outcome' }],
            valueKey: [{ id: 'decisions.decision', aggregation: 'count' }],
          },
        },
        heatmap: { type: 'rule-heatmap' },
        flow: { type: 'money-flow-sankey' },
        stream: { type: 'decision-stream' },
        firing: {
          type: 'column-chart-grouped',
          format: { title: { text: 'Rules that fired', enabled: true } },
          dataMapping: {
            categoryKey: [{ id: 'rules.rule' }],
            valueKey: [{ id: 'rules.decision', aggregation: 'count' }],
          },
        },
        lab: { type: 'lab-scorecard' },
        incidents: {
          type: 'grid',
          format: { title: { text: 'Incidents', enabled: true } },
          dataMapping: {
            cols: [
              { id: 'incidents.kind' },
              { id: 'incidents.severity' },
              { id: 'incidents.status' },
              { id: 'incidents.openedAt' },
            ],
          },
        },
      },
      widgetLayout: {
        ...place('envelope', 0, 0, 8, 19),
        ...place('verification', 8, 0, 8, 19),
        ...place('outcomes', 16, 0, 8, 19),
        ...place('heatmap', 0, 19, 12, 26),
        ...place('flow', 12, 19, 12, 26),
        ...place('stream', 0, 45, 14, 24),
        ...place('firing', 14, 45, 10, 24),
        ...place('lab', 0, 69, 8, 20),
        ...place('incidents', 8, 69, 16, 20),
      },
    },
  ],
  selectedPageId: 'cockpit',
  panels: { filters: { collapsed: true } },
} as unknown as AgReportState<BursarRegistry>;

const KEY = 'bursar.cockpit.layout.v1';

/** The layout the person last left, kept in this browser only. Anything unreadable falls back to the default. */
export function loadLayout(orgId: string): AgReportState<BursarRegistry> {
  try {
    const raw = window.localStorage.getItem(`${KEY}.${orgId}`);
    return raw === null ? DEFAULT_STATE : (JSON.parse(raw) as AgReportState<BursarRegistry>);
  } catch {
    return DEFAULT_STATE;
  }
}

export function saveLayout(orgId: string, state: AgReportState<BursarRegistry> | null): void {
  try {
    if (state === null) window.localStorage.removeItem(`${KEY}.${orgId}`);
    else window.localStorage.setItem(`${KEY}.${orgId}`, JSON.stringify(state));
  } catch {
    // Storage can be blocked; the cockpit still works, it just forgets the layout.
  }
}
