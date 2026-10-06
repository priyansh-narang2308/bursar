import { type AgReportState, AgStudioAiModule, type AgStudioApi } from 'ag-studio';
import { AgStudio } from 'ag-studio-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { EmptyState, ErrorNote, Panel, SimBadge, Skeleton } from '../components/ui';
import { useCockpit, useMe } from '../lib/queries';
import { createTreasurerHarness, treasurerToolDisplay } from '../studio/ai';
import { loadLayout, saveLayout, toSources } from '../studio/model';
import { type BursarRegistry, bursarWidgets } from '../studio/registry';
import { cockpitStore } from '../studio/store';
import { bursarStudioTheme } from '../studio/theme';
import { PageHead } from './parts';

/**
 * The cockpit: AG Studio, themed with Bursar's tokens, drawing figures the server worked out. A person can
 * rearrange it in edit mode; the layout is kept in this browser and survives refreshes and live updates.
 */
const MODULES = [AgStudioAiModule];
const harness = ({ api }: { api: AgStudioApi }) => createTreasurerHarness(api);

export function Cockpit() {
  const me = useMe();
  const cockpit = useCockpit();
  const orgId = me.data?.orgId ?? 'workspace';
  const [mode, setMode] = useState<'view' | 'edit'>('view');
  const [generation, setGeneration] = useState(0);
  const studio = useRef<Pick<AgStudioApi, 'getState'> | null>(null);
  const initialState = useMemo(() => loadLayout(orgId), [orgId, generation]);
  const data = useMemo(() => (cockpit.data ? toSources(cockpit.data) : undefined), [cockpit.data]);

  useEffect(() => {
    cockpitStore.setCockpit(cockpit.data ?? null);
  }, [cockpit.data]);
  useEffect(() => () => cockpitStore.clearRule(), []);

  const remember = useCallback(() => {
    const state = studio.current?.getState();
    if (state !== undefined) saveLayout(orgId, state as AgReportState<BursarRegistry>);
  }, [orgId]);
  const reset = () => {
    saveLayout(orgId, null);
    setGeneration((n) => n + 1);
  };

  return (
    <div className="content cockpit">
      <PageHead
        title="Studio"
        sub={
          <>
            The workspace as charts, tables and bespoke widgets. Every figure is worked out on the
            server; pick a rule in the heatmap or the stream and the others narrow to it.{' '}
            <SimBadge>sandbox data</SimBadge>
          </>
        }
        action={
          <span className="row">
            <button
              type="button"
              className="btn"
              aria-pressed={mode === 'edit'}
              onClick={() => setMode(mode === 'edit' ? 'view' : 'edit')}
            >
              {mode === 'edit' ? 'Done editing' : 'Edit layout'}
            </button>
            <button type="button" className="btn btn-ghost" onClick={reset}>
              Reset layout
            </button>
          </span>
        }
      />
      {cockpit.isError && (
        <Panel>
          <ErrorNote error={cockpit.error} retry={() => cockpit.refetch()} />
        </Panel>
      )}
      {cockpit.isPending && (
        <Panel>
          <Skeleton width="40%" />
          <Skeleton width="80%" />
        </Panel>
      )}
      {cockpit.data && cockpit.data.decisions.length === 0 && (
        <Panel>
          <EmptyState title="Nothing to chart yet">
            Run the agents on a mission, then come back: every ruling, rule and movement of money
            appears here.
          </EmptyState>
        </Panel>
      )}
      {data !== undefined && (
        <div className="studio-host">
          <AgStudio<BursarRegistry>
            key={generation}
            style={{ height: '100%', width: '100%' }}
            data={data}
            mode={mode}
            theme={bursarStudioTheme}
            widgets={bursarWidgets}
            modules={MODULES}
            ai={harness as never}
            aiToolDisplay={treasurerToolDisplay}
            initialState={initialState}
            onApiReady={(event) => {
              studio.current = event.api;
            }}
            onStateUpdated={remember}
          />
        </div>
      )}
    </div>
  );
}
