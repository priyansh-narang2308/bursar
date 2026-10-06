import type { AgDefaultRegistry } from 'ag-studio';
import { type AgRegistry, type AgWidgetDefinition, createWidgets } from 'ag-studio-react';
import {
  DecisionStream,
  EnvelopeGauge,
  LabScorecard,
  MoneyFlowSankey,
  RuleHeatmap,
  VerificationStatus,
} from './widgets';

type CustomId =
  | 'envelope-gauge'
  | 'decision-stream'
  | 'rule-heatmap'
  | 'money-flow-sankey'
  | 'verification-status'
  | 'lab-scorecard';

/** Studio's registry, plus the ids of Bursar's own widgets, so a layout that names one is checked. */
export interface BursarRegistry extends AgRegistry {
  widgets: readonly (AgDefaultRegistry['widgets'][number] | AgWidgetDefinition<CustomId>)[];
}

const icon = (path: string) =>
  `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="${path}"/></svg>`;

/** One definition per custom widget: where it sits in the menu, its size, and a form that leans on Studio's defaults. */
const define = (
  id: CustomId,
  label: string,
  path: string,
  comp: AgWidgetDefinition['comp'],
  size: { width: number; height: number },
): AgWidgetDefinition<CustomId> => ({
  id,
  label,
  icon: icon(path),
  comp,
  form: (params) => params.createDefaults({}),
  defaultSize: size,
  minSize: { width: 240, height: 160 },
  featureConfig: { crossFilter: { supportsHighlight: false } },
});

export const bursarWidgets = createWidgets<BursarRegistry>({
  additionalTypes: [
    define('envelope-gauge', 'Envelope gauge', 'M3 12a5 5 0 0 1 10 0M8 12l3-4', EnvelopeGauge, {
      width: 320,
      height: 300,
    }),
    define('decision-stream', 'Decision stream', 'M3 4h10M3 8h10M3 12h6', DecisionStream, {
      width: 560,
      height: 380,
    }),
    define(
      'rule-heatmap',
      'Rule heatmap',
      'M3 3h4v4H3zM9 3h4v4H9zM3 9h4v4H3zM9 9h4v4H9z',
      RuleHeatmap,
      { width: 480, height: 420 },
    ),
    define(
      'money-flow-sankey',
      'Money flow',
      'M2 4c5 0 5 8 12 8M2 8c5 0 5 4 12 4',
      MoneyFlowSankey,
      { width: 480, height: 420 },
    ),
    define('verification-status', 'Verification status', 'M3.5 8.5l3 3 6-7', VerificationStatus, {
      width: 320,
      height: 300,
    }),
    define(
      'lab-scorecard',
      'Lab scorecard',
      'M6.5 2.5h3M7 2.5v4L3.5 12.5h9L9 6.5v-4',
      LabScorecard,
      { width: 320, height: 320 },
    ),
  ],
  menu: [
    {
      label: 'Bursar',
      widgetIds: [
        'envelope-gauge',
        'decision-stream',
        'rule-heatmap',
        'money-flow-sankey',
        'verification-status',
        'lab-scorecard',
      ],
    },
  ],
});
