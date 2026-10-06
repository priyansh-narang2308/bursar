import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { ErrorNote, Skeleton } from '../components/ui';
import { ApiError, api } from './api';
import { useMe } from './queries';

/** Opens a populated demo workspace (no sign-up) and goes to the dashboard. */
export function useOpenDemo() {
  const client = useQueryClient();
  const navigate = useNavigate();
  return useMutation({
    mutationFn: () => api.post('/v1/demo/workspace', { name: 'Demo workspace' }),
    onSuccess: async () => {
      await client.resetQueries();
      navigate('/dashboard');
    },
  });
}

export function OpenDemoButton({
  size = 'lg',
  label = 'Open demo workspace',
}: {
  size?: 'lg' | 'md';
  label?: string;
}) {
  const open = useOpenDemo();
  return (
    <span className="row" style={{ gap: 10 }}>
      <button
        type="button"
        className={`btn btn-primary ${size === 'lg' ? 'btn-lg' : ''}`}
        disabled={open.isPending}
        onClick={() => open.mutate()}
      >
        {open.isPending ? 'Opening…' : label}
      </button>
      {open.isError && (
        <span className="hint" role="alert">
          {open.error instanceof ApiError ? open.error.readable : 'Could not open a workspace.'}
        </span>
      )}
    </span>
  );
}

/** Shows its children once there is a session; otherwise offers to open a demo workspace. */
export function RequireSession({ children }: { children: ReactNode }) {
  const me = useMe();
  if (me.isPending)
    return (
      <div className="content">
        <Skeleton width="30%" />
        <Skeleton width="60%" />
      </div>
    );
  if (me.error instanceof ApiError && me.error.status === 401)
    return (
      <div className="content">
        <div className="panel">
          <div className="empty">
            <span className="empty-title">There is no workspace open</span>
            <span className="muted">
              Open a demo workspace to explore Bursar with realistic data. No sign-up.
            </span>
            <OpenDemoButton />
          </div>
        </div>
      </div>
    );
  if (me.isError)
    return (
      <div className="content">
        <ErrorNote error={me.error} retry={() => void me.refetch()} />
      </div>
    );
  return children;
}
