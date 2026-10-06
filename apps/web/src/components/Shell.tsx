import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import {
  currentMandate,
  useApprovals,
  useAuditVerdict,
  useLiveEvents,
  useMandates,
  useMe,
  useWorkspace,
} from '../lib/queries';
import { Badge, Dialog, Field, Icon, type IconName, Logo, StateBadge, useToast } from './ui';

interface NavEntry {
  to: string;
  label: string;
  icon: IconName;
  soon?: boolean;
}
const NAV: { label: string; items: NavEntry[] }[] = [
  {
    label: 'Workspace',
    items: [
      { to: '/dashboard', label: 'Overview', icon: 'home' },
      { to: '/dashboard/missions', label: 'Missions', icon: 'target' },
      { to: '/dashboard/approvals', label: 'Approvals', icon: 'check' },
      { to: '/dashboard/activity', label: 'Activity', icon: 'list' },
    ],
  },
  {
    label: 'Controls',
    items: [
      { to: '/dashboard/mandate', label: 'Mandate', icon: 'shield' },
      { to: '/dashboard/policy', label: 'Policy', icon: 'file' },
      { to: '/dashboard/incidents', label: 'Incidents', icon: 'alert' },
      { to: '/dashboard/integrations', label: 'Integrations', icon: 'grid' },
    ],
  },
  {
    label: 'Agents',
    items: [
      { to: '/dashboard/agents', label: 'Agents & keys', icon: 'key' },
      { to: '/dashboard/studio', label: 'Studio', icon: 'grid', soon: true },
      { to: '/dashboard/schedule', label: 'Schedule', icon: 'cal' },
    ],
  },
  {
    label: 'Prove',
    items: [
      { to: '/dashboard/lab', label: 'Policy lab', icon: 'flask' },
      { to: '/dashboard/gauntlet', label: 'Gauntlet', icon: 'shield' },
    ],
  },
];

const ROLES = ['OWNER', 'APPROVER', 'OPERATOR', 'AUDITOR'] as const;

function Sidebar({ pending, name }: { pending: number; name: string | undefined }) {
  return (
    <aside className="sidebar">
      <Link to="/" className="brand" aria-label="Bursar home">
        <Logo /> Bursar
      </Link>
      {NAV.map((group) => (
        <nav key={group.label} className="nav-group" aria-label={group.label}>
          <span className="nav-label">{group.label}</span>
          {group.items.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.to === '/dashboard'} className="nav-item">
              <Icon name={item.icon} />
              {item.label}
              {item.label === 'Approvals' && pending > 0 && (
                <Badge tone="warn" plain>
                  {pending}
                </Badge>
              )}
              {item.soon && <span className="nav-soon">soon</span>}
            </NavLink>
          ))}
        </nav>
      ))}
      <div className="sidebar-foot">
        <span className="faint" style={{ fontSize: 12 }}>
          {name ?? 'Workspace'}
        </span>
      </div>
    </aside>
  );
}

function FreezeControl({ mandateId, frozen }: { mandateId: string; frozen: boolean }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const client = useQueryClient();
  const toast = useToast();
  const change = useMutation({
    mutationFn: () =>
      api.post(`/v1/mandates/${mandateId}/${frozen ? 'unfreeze' : 'freeze'}`, {
        reason: reason || (frozen ? 'Resumed by the owner' : 'Frozen by the owner'),
      }),
    onSuccess: () => {
      toast('ok', frozen ? 'Spending resumed.' : 'Frozen. Nothing can be spent until you resume.');
      setOpen(false);
      setReason('');
      void client.invalidateQueries();
    },
    onError: (error: Error) =>
      toast('bad', (error as { readable?: string }).readable ?? error.message),
  });
  return (
    <>
      <button
        type="button"
        className={frozen ? 'btn' : 'btn btn-danger'}
        onClick={() => setOpen(true)}
      >
        <Icon name="snow" /> {frozen ? 'Resume spending' : 'Freeze'}
      </button>
      {open && (
        <Dialog
          title={frozen ? 'Resume spending?' : 'Freeze all spending?'}
          onClose={() => setOpen(false)}
          footer={
            <>
              <button type="button" className="btn" onClick={() => setOpen(false)}>
                Cancel
              </button>
              <button
                type="button"
                className={frozen ? 'btn btn-primary' : 'btn btn-danger'}
                disabled={change.isPending}
                onClick={() => change.mutate()}
              >
                {frozen ? 'Resume' : 'Freeze now'}
              </button>
            </>
          }
        >
          <p className="muted">
            {frozen
              ? 'Agents will be able to spend again, inside the same limits.'
              : 'No new hold or payment is made while the mandate is frozen. Money already held stays held. You can resume at any time.'}
          </p>
          <Field label="Reason (optional)">
            {(id) => (
              <input
                id={id}
                className="input"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="What happened?"
              />
            )}
          </Field>
        </Dialog>
      )}
    </>
  );
}

function RoleSwitch({ role }: { role: string }) {
  const client = useQueryClient();
  const toast = useToast();
  const change = useMutation({
    mutationFn: (next: string) => api.post('/v1/demo/role', { role: next }),
    onSuccess: async (_d, next) => {
      await client.invalidateQueries();
      toast('ok', `Now viewing as ${next.toLowerCase()}.`);
    },
    onError: (error: Error) => toast('bad', error.message),
  });
  return (
    <label className="row" style={{ gap: 6 }}>
      <span className="sr-only">View as</span>
      <select
        className="select"
        style={{ width: 118, minHeight: 28, padding: '2px 8px' }}
        value={role}
        onChange={(e) => change.mutate(e.target.value)}
        aria-label="View as role"
      >
        {ROLES.map((r) => (
          <option key={r} value={r}>
            {r.charAt(0) + r.slice(1).toLowerCase()}
          </option>
        ))}
      </select>
    </label>
  );
}

function Palette({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const navigate = useNavigate();
  const entries = useMemo(
    () => NAV.flatMap((g) => g.items.filter((i) => !i.soon).map((i) => ({ ...i, group: g.label }))),
    [],
  );
  const shown = entries.filter((e) => e.label.toLowerCase().includes(query.toLowerCase()));
  const go = (to: string) => {
    onClose();
    navigate(to);
  };
  return (
    <>
      <button
        type="button"
        className="scrim"
        aria-label="Close"
        onClick={onClose}
        style={{ border: 0 }}
      />
      <div className="dialog" role="dialog" aria-modal="true" aria-label="Go to">
        <input
          className="input"
          style={{
            border: 0,
            borderBottom: '1px solid var(--border)',
            borderRadius: 0,
            minHeight: 44,
            padding: '0 14px',
          }}
          placeholder="Go to…"
          aria-label="Go to"
          // biome-ignore lint/a11y/noAutofocus: a palette exists to be typed into at once
          autoFocus
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setIndex(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') setIndex((i) => Math.min(i + 1, shown.length - 1));
            if (e.key === 'ArrowUp') setIndex((i) => Math.max(i - 1, 0));
            const chosen = shown[index];
            if (e.key === 'Enter' && chosen) go(chosen.to);
          }}
        />
        <div className="palette-list" role="listbox" aria-label="Pages">
          {shown.length === 0 && (
            <p className="muted" style={{ padding: 10 }}>
              Nothing matches.
            </p>
          )}
          {shown.map((e, i) => (
            <button
              key={e.to}
              className="palette-item"
              type="button"
              role="option"
              aria-selected={i === index}
              onClick={() => go(e.to)}
            >
              <span className="row">
                <Icon name={e.icon} /> {e.label}
              </span>
              <span className="faint">{e.group}</span>
            </button>
          ))}
        </div>
      </div>
    </>
  );
}

function Topbar({ title }: { title: ReactNode }) {
  const me = useMe();
  const mandates = useMandates();
  const audit = useAuditVerdict();
  const [palette, setPalette] = useState(false);
  const mandate = currentMandate(mandates.data);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPalette((open) => !open);
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);
  const canFreeze = me.data?.role === 'OWNER';
  return (
    <header className="topbar">
      <span className="muted">{title}</span>
      <div className="topbar-right">
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPalette(true)}>
          <Icon name="search" /> Go to <kbd>⌘K</kbd>
        </button>
        {audit.data && (
          <Badge tone={audit.data.ok ? 'ok' : 'bad'}>
            {audit.data.ok ? 'Audit chain verified' : 'Audit chain broken'}
          </Badge>
        )}
        {mandate ? (
          <span className="row" style={{ gap: 6 }}>
            <span className="faint">Mandate</span>
            <StateBadge state={mandate.status} />
          </span>
        ) : (
          <Badge>No mandate</Badge>
        )}
        {mandate && canFreeze && (mandate.status === 'ACTIVE' || mandate.status === 'FROZEN') && (
          <FreezeControl mandateId={mandate.id} frozen={mandate.status === 'FROZEN'} />
        )}
        {me.data && <RoleSwitch role={me.data.role} />}
      </div>
      {palette && <Palette onClose={() => setPalette(false)} />}
    </header>
  );
}

/** The dashboard: a sidebar of everything the product does, and the page on the right. */
export function Shell() {
  const me = useMe();
  const workspace = useWorkspace();
  const approvals = useApprovals(me.data?.role === 'OWNER' || me.data?.role === 'APPROVER');
  useLiveEvents(me.isSuccess);
  return (
    <div className="app">
      <Sidebar pending={approvals.data?.length ?? 0} name={workspace.data?.name} />
      <div className="main">
        <Topbar title={workspace.data?.name ?? 'Dashboard'} />
        <Outlet />
      </div>
    </div>
  );
}
