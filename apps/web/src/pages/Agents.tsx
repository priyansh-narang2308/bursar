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
  TableSkeleton,
  useToast,
} from '../components/ui';
import { api } from '../lib/api';
import { formatTime } from '../lib/format';
import { useAgents, useMe } from '../lib/queries';
import { PageHead } from './parts';

interface Issued {
  id: string;
  key: string;
}

function Reveal({ issued, onClose }: { issued: Issued; onClose: () => void }) {
  const command = `claude mcp add --transport http bursar ${window.location.origin}/v1/mcp --header "Authorization: Bearer ${issued.key}"`;
  const [copied, setCopied] = useState(false);
  return (
    <Dialog
      title="Your new key"
      onClose={onClose}
      footer={
        <button type="button" className="btn btn-primary" onClick={onClose}>
          Done
        </button>
      }
    >
      <p className="callout callout-warn">
        This is the only time the key is shown. Bursar keeps only a hash of it.
      </p>
      <Field label="Key">
        {(id) => (
          <input
            id={id}
            className="input mono"
            readOnly
            value={issued.key}
            onFocus={(e) => e.target.select()}
          />
        )}
      </Field>
      <Field
        label="Connect Claude Code"
        hint="Run this in a terminal to give Claude the guarded tools."
      >
        {(id) => (
          <textarea
            id={id}
            className="textarea mono"
            readOnly
            rows={3}
            value={command}
            onFocus={(e) => e.target.select()}
          />
        )}
      </Field>
      <div>
        <button
          type="button"
          className="btn btn-sm"
          onClick={() => void navigator.clipboard?.writeText(command).then(() => setCopied(true))}
        >
          {copied ? 'Copied' : 'Copy command'}
        </button>
      </div>
    </Dialog>
  );
}

export function Agents() {
  const agents = useAgents();
  const me = useMe();
  const manage = me.data?.role === 'OWNER' || me.data?.role === 'OPERATOR';
  const [name, setName] = useState('');
  const [issued, setIssued] = useState<Issued | null>(null);
  const client = useQueryClient();
  const toast = useToast();
  const fail = (e: Error) => toast('bad', (e as { readable?: string }).readable ?? e.message);
  const refresh = () => void client.invalidateQueries({ queryKey: ['agents'] });
  const create = useMutation({
    mutationFn: () => api.post<{ id: string }>('/v1/agents', { name }),
    onSuccess: () => {
      setName('');
      refresh();
    },
    onError: fail,
  });
  const issue = useMutation({
    mutationFn: (agentId: string) => api.post<Issued>(`/v1/agents/${agentId}/keys`, {}),
    onSuccess: (key) => {
      setIssued(key);
      refresh();
    },
    onError: fail,
  });
  const revoke = useMutation({
    mutationFn: ({ agentId, keyId }: { agentId: string; keyId: string }) =>
      api.del(`/v1/agents/${agentId}/keys/${keyId}`),
    onSuccess: () => {
      toast('ok', 'Key revoked. It stops working at once.');
      refresh();
    },
    onError: fail,
  });
  return (
    <div className="content">
      <PageHead
        title="Agents & keys"
        sub="An agent is something that proposes spending. Its key can only read and propose; it can never approve, and it never sees a secret."
      />
      {manage && (
        <Panel title="New agent">
          <form
            className="row"
            onSubmit={(e) => {
              e.preventDefault();
              if (name.trim()) create.mutate();
            }}
          >
            <input
              className="input"
              style={{ maxWidth: 320 }}
              placeholder="Name, such as “Procurement bot”"
              aria-label="Agent name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <button
              type="submit"
              className="btn btn-primary"
              disabled={!name.trim() || create.isPending}
            >
              Create agent
            </button>
          </form>
        </Panel>
      )}
      {agents.isPending && (
        <Panel flush>
          <TableSkeleton />
        </Panel>
      )}
      {agents.isError && (
        <Panel>
          <ErrorNote error={agents.error} retry={() => void agents.refetch()} />
        </Panel>
      )}
      {agents.data?.length === 0 && (
        <Panel>
          <EmptyState title="No agents yet">
            Create one, issue it a key, and connect Claude over MCP.
          </EmptyState>
        </Panel>
      )}
      {agents.data?.map((agent) => (
        <Panel
          key={agent.id}
          title={
            <span className="row">
              {agent.name} <IdChip id={agent.id} />
            </span>
          }
          action={
            manage ? (
              <button
                type="button"
                className="btn btn-sm"
                disabled={issue.isPending}
                onClick={() => issue.mutate(agent.id)}
              >
                Issue key
              </button>
            ) : undefined
          }
          flush
        >
          {agent.keys.length === 0 ? (
            <EmptyState title="No keys">Issue a key to let this agent connect.</EmptyState>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Key</th>
                  <th>Scopes</th>
                  <th>Created</th>
                  <th className="right">Status</th>
                </tr>
              </thead>
              <tbody>
                {agent.keys.map((k) => (
                  <tr key={k.id}>
                    <td>
                      <IdChip id={k.id} />
                    </td>
                    <td className="muted">{k.scopes.join(', ')}</td>
                    <td className="faint">{formatTime(k.createdAt)}</td>
                    <td className="right">
                      {k.revokedAt ? (
                        <Badge tone="bad">Revoked</Badge>
                      ) : manage ? (
                        <button
                          type="button"
                          className="btn btn-sm btn-danger"
                          onClick={() => revoke.mutate({ agentId: agent.id, keyId: k.id })}
                        >
                          Revoke
                        </button>
                      ) : (
                        <Badge tone="ok">Active</Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>
      ))}
      {issued && <Reveal issued={issued} onClose={() => setIssued(null)} />}
    </div>
  );
}
