import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
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
import { Badge, Dialog, Field, Icon, type IconName, Logo, useEscape, useToast } from './ui';

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
      { to: '/dashboard/studio', label: 'Studio', icon: 'grid' },
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

const SIDEBAR_KEY = 'bursar.sidebar';

/**
 * Whether the sidebar is shown. It remembers the choice in this browser, starts closed on a phone, and answers
 * the keyboard shortcut (Cmd or Ctrl and B) from anywhere on the page.
 */
function useSidebar() {
  const [open, setOpen] = useState(() => {
    try {
      const saved = window.localStorage.getItem(SIDEBAR_KEY);
      if (saved !== null) return saved === 'open';
    } catch {
      // Storage can be blocked; the sidebar then simply opens by default.
    }
    return (
      typeof window.matchMedia !== 'function' || !window.matchMedia('(max-width: 900px)').matches
    );
  });
  const toggle = useCallback(() => {
    setOpen((was) => {
      try {
        window.localStorage.setItem(SIDEBAR_KEY, was ? 'closed' : 'open');
      } catch {
        // Not remembered, still toggled.
      }
      return !was;
    });
  }, []);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        toggle();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [toggle]);
  return { open, toggle };
}

function Sidebar({ pending, name }: { pending: number; name: string | undefined }) {
  return (
    <aside className="sidebar" id="sidebar">
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

const ROLE_DETAILS: Record<string, { label: string; desc: string }> = {
  OWNER: { label: 'Owner', desc: 'Full controls & mandate' },
  APPROVER: { label: 'Approver', desc: 'Review & approve spending' },
  OPERATOR: { label: 'Operator', desc: 'Launch agent missions' },
  AUDITOR: { label: 'Auditor', desc: 'Read-only audit verification' },
};

function RoleSwitch({ role }: { role: string }) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
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

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  const selectRole = (next: string) => {
    setOpen(false);
    if (next !== role) {
      change.mutate(next);
    }
  };

  const activeRole = ROLE_DETAILS[role] ?? {
    label: role.charAt(0) + role.slice(1).toLowerCase(),
    desc: 'Workspace role',
  };

  return (
    <div className="topbar-dropdown" ref={containerRef}>
      <select
        className="sr-only"
        value={role}
        onChange={(e) => change.mutate(e.target.value)}
        aria-label="View as role"
      >
        {ROLES.map((r) => (
          <option key={r} value={r}>
            {ROLE_DETAILS[r]?.label ?? r}
          </option>
        ))}
      </select>

      <button
        type="button"
        className={`topbar-dropdown-btn ${open ? 'open' : ''}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
        title="Switch simulated role"
      >
        <span className="topbar-role-icon">
          <Icon name="user" size={13} />
        </span>
        <span className="topbar-role-name">{activeRole.label}</span>
        <span className={`topbar-dropdown-chevron ${open ? 'rotated' : ''}`}>
          <Icon name="chevron" size={11} />
        </span>
      </button>

      {open && (
        <div className="topbar-dropdown-menu" role="listbox" aria-label="Select role">
          <div className="topbar-dropdown-heading">SIMULATE ROLE</div>
          <div className="topbar-dropdown-items">
            {ROLES.map((r) => {
              const info = ROLE_DETAILS[r] ?? { label: r, desc: '' };
              const active = r === role;
              return (
                <button
                  key={r}
                  type="button"
                  role="option"
                  aria-selected={active}
                  className={`topbar-dropdown-item ${active ? 'active' : ''}`}
                  onClick={() => selectRole(r)}
                >
                  <div className="topbar-dropdown-item-text">
                    <span className="topbar-dropdown-item-title">{info.label}</span>
                    <span className="topbar-dropdown-item-desc">{info.desc}</span>
                  </div>
                  {active && (
                    <span className="topbar-dropdown-item-icon">
                      <Icon name="check" size={13} />
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function Palette({ onClose }: { onClose: () => void }) {
  useEscape(onClose);
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
  // On the page body: the top bar has a backdrop filter, which would trap a fixed dialog inside its 60 px.
  return createPortal(
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
    </>,
    document.body,
  );
}

function Topbar({
  title,
  sidebarOpen,
  onToggleSidebar,
}: {
  title: ReactNode;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
}) {
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
      <div className="topbar-left">
        <button
          type="button"
          className="btn btn-ghost btn-sm btn-icon"
          aria-label="Toggle sidebar"
          aria-expanded={sidebarOpen}
          aria-controls="sidebar"
          title="Toggle sidebar (⌘B)"
          onClick={onToggleSidebar}
        >
          <Icon name="sidebar" />
        </button>
        <span className="topbar-title-text">{title}</span>
      </div>
      <div className="topbar-search-wrap">
        <button
          type="button"
          className="topbar-search-btn"
          onClick={() => setPalette(true)}
          aria-label="Go to (⌘K)"
          title="Search or go to… (⌘K)"
        >
          <span className="topbar-search-btn-left">
            <Icon name="search" size={13} />
            <span className="topbar-search-btn-placeholder">Search or jump to…</span>
          </span>
          <kbd className="topbar-search-kbd">⌘K</kbd>
        </button>
      </div>
      <div className="topbar-right">
        <div className="topbar-status-group">
          {audit.data && (
            <Badge tone={audit.data.ok ? 'ok' : 'bad'}>
              {audit.data.ok ? 'Audit chain verified' : 'Audit chain broken'}
            </Badge>
          )}
        </div>
        <span className="topbar-divider" />
        <div className="topbar-actions-group">
          {mandate && canFreeze && (mandate.status === 'ACTIVE' || mandate.status === 'FROZEN') && (
            <FreezeControl mandateId={mandate.id} frozen={mandate.status === 'FROZEN'} />
          )}
          {me.data && <RoleSwitch role={me.data.role} />}
        </div>
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
  const sidebar = useSidebar();
  return (
    <div className="app" data-sidebar={sidebar.open ? 'open' : 'closed'}>
      <Sidebar pending={approvals.data?.length ?? 0} name={workspace.data?.name} />
      <div className="main">
        <Topbar
          title={workspace.data?.name ?? 'Dashboard'}
          sidebarOpen={sidebar.open}
          onToggleSidebar={sidebar.toggle}
        />
        <Outlet />
      </div>
    </div>
  );
}
