import { Badge, ErrorNote, IdChip, Panel, SimBadge, TableSkeleton } from '../components/ui';
import { useIntegrations } from '../lib/queries';
import { PageHead } from './parts';

const ROWS = [
  ['paypal', 'PayPal', 'Holds, captures, refunds, payouts and signed webhooks'],
  ['catalog', 'Product catalog', 'Where agents search for things to buy'],
  ['model', 'Agent model', 'What plans, researches and proposes'],
] as const;

export function Integrations() {
  const data = useIntegrations();
  return (
    <div className="content">
      <PageHead
        title="Integrations"
        sub="Which services are real, and which are stand-ins. Anything simulated says so here and wherever it shows up."
      />
      <Panel flush>
        {data.isPending && <TableSkeleton rows={3} />}
        {data.isError && <ErrorNote error={data.error} retry={() => void data.refetch()} />}
        {data.data && (
          <table className="table">
            <thead>
              <tr>
                <th>Service</th>
                <th>Mode</th>
                <th>Detail</th>
              </tr>
            </thead>
            <tbody>
              {ROWS.map(([key, name, what]) => {
                const item = data.data[key];
                const simulated = ['fake', 'offline', 'scripted'].includes(item.mode);
                return (
                  <tr key={key} style={{ verticalAlign: 'top' }}>
                    <td style={{ padding: '10px 14px', height: 'auto' }}>
                      <strong>{name}</strong>
                      <br />
                      <span className="faint">{what}</span>
                    </td>
                    <td style={{ padding: '10px 14px', height: 'auto' }}>
                      {simulated ? (
                        <SimBadge>{item.mode}</SimBadge>
                      ) : (
                        <Badge tone={item.mode === 'off' ? 'neutral' : 'ok'}>{item.mode}</Badge>
                      )}
                    </td>
                    <td
                      className="muted"
                      style={{ padding: '10px 14px', height: 'auto', maxWidth: 440 }}
                    >
                      {item.detail}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Panel>
      {data.data && (
        <Panel title="MCP gateway">
          <div className="stack">
            <p className="muted">
              Agents outside Bursar (Claude, for one) connect here. They are given only the guarded
              tools; PayPal’s own money tools are redirected, and everything else is blocked.
            </p>
            <p className="row">
              <span className="faint">Endpoint</span>{' '}
              <IdChip id={`${window.location.origin}${data.data.mcp.path}`} short={false} />
            </p>
            <p className="hint">
              Create a key on the Agents page to get the full `claude mcp add` command.
            </p>
          </div>
        </Panel>
      )}
    </div>
  );
}
