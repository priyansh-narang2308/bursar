import { EmptyState, ErrorNote, IdChip, Panel, TableSkeleton } from '../components/ui';
import { formatMoney } from '../lib/format';
import { usePolicy } from '../lib/queries';
import { PageHead } from './parts';

const isAmount = (v: unknown): v is { currency: string; minor: string } =>
  typeof v === 'object' && v !== null && 'currency' in v && 'minor' in v;

/** A rule's parameters as short readable pairs, with amounts written as money. */
function Params({ value }: { value: unknown }) {
  const entries = typeof value === 'object' && value !== null ? Object.entries(value) : [];
  if (entries.length === 0) return <span className="faint">none</span>;
  return (
    <span className="stack" style={{ gap: 2 }}>
      {entries.map(([key, v]) => (
        <span key={key} className="mono">
          <span className="faint">{key}</span>{' '}
          {isAmount(v) ? formatMoney(v.minor, v.currency) : JSON.stringify(v)}
        </span>
      ))}
    </span>
  );
}

export function Policy() {
  const policy = usePolicy();
  return (
    <div className="content">
      <PageHead
        title="Policy"
        sub="The rules every proposal is checked against, and again at the moment money moves. They are plain code: the same inputs always give the same ruling. No model can change them."
        action={
          policy.data && (
            <span className="row">
              <span className="faint">version hash</span> <IdChip id={policy.data.hash} />
            </span>
          )
        }
      />
      <Panel flush>
        {policy.isPending && <TableSkeleton rows={6} />}
        {policy.isError && <ErrorNote error={policy.error} retry={() => void policy.refetch()} />}
        {policy.data?.rules.length === 0 && (
          <EmptyState title="No rules">
            An organisation with no rules would deny everything.
          </EmptyState>
        )}
        {policy.data && policy.data.rules.length > 0 && (
          <table className="table">
            <thead>
              <tr>
                <th>Rule</th>
                <th>What it checks</th>
                <th>Parameters</th>
              </tr>
            </thead>
            <tbody>
              {policy.data.rules.map((r) => (
                <tr key={r.id} style={{ verticalAlign: 'top' }}>
                  <td style={{ padding: '10px 14px', whiteSpace: 'nowrap' }}>
                    <span className="mono">{r.id}</span> <span className="faint">v{r.version}</span>
                  </td>
                  <td
                    className="muted"
                    style={{ padding: '10px 14px', maxWidth: 480, height: 'auto' }}
                  >
                    {r.summary}
                  </td>
                  <td style={{ padding: '10px 14px', height: 'auto' }}>
                    <Params value={r.params} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </div>
  );
}
