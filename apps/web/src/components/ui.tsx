import {
  Component,
  createContext,
  type ErrorInfo,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useState,
} from 'react';
import { formatMoney, humanize, shortId } from '../lib/format';

// ---------------------------------------------------------------------------------------------------
// Marks and icons: one stroke weight, drawn for this product
// ---------------------------------------------------------------------------------------------------

export function Logo({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect
        x="4.5"
        y="4.5"
        width="23"
        height="23"
        rx="5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
      />
      <path d="M9.5 22.5 22.5 9.5" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />
    </svg>
  );
}

const PATHS = {
  home: 'M3 9.5 8 4.5l5 5V13H3z',
  target: 'M8 2.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11Zm0 3a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5Z',
  check: 'm3.5 8.5 3 3 6-7',
  list: 'M3 4.5h10M3 8h10M3 11.5h6',
  shield: 'M8 2 3 4v4c0 3 2 5 5 6 3-1 5-3 5-6V4z',
  key: 'M10 6.5a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0Zm-2.5 2.5v4.5m0-2H9m-1.5-1H9',
  alert: 'M8 3 2.5 12.5h11zM8 7v2.5M8 11v.01',
  file: 'M4 2.5h5l3 3v8H4zM9 2.5v3h3',
  cal: 'M3 4.5h10v8H3zM3 7h10M6 3v3M10 3v3',
  flask: 'M6.5 2.5h3M7 2.5v4L3.5 12.5h9L9 6.5v-4',
  grid: 'M3 3h4v4H3zM9 3h4v4H9zM3 9h4v4H3zM9 9h4v4H9z',
  snow: 'M8 2v12M3 5l10 6M13 5 3 11',
  search: 'm10.5 10.5 3 3M7 11.5a4.5 4.5 0 1 1 0-9 4.5 4.5 0 0 1 0 9Z',
  copy: 'M5.5 5.5h7v7h-7zM3.5 10.5v-8h7',
  close: 'm4 4 8 8M12 4l-8 8',
  arrow: 'M3 8h10M9 4l4 4-4 4',
  play: 'M5 3.5v9l7-4.5z',
  sidebar: 'M2.5 3.5h11v9h-11zM6 3.5v9',
} as const;
export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 15 }: { name: IconName; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}

// ---------------------------------------------------------------------------------------------------
// Small components
// ---------------------------------------------------------------------------------------------------

export type Tone = 'neutral' | 'ok' | 'warn' | 'bad';

export function Badge({
  tone = 'neutral',
  plain = false,
  children,
}: {
  tone?: Tone;
  plain?: boolean;
  children: ReactNode;
}) {
  const cls = ['badge', tone === 'neutral' ? '' : `badge-${tone}`, plain ? 'badge-plain' : '']
    .filter(Boolean)
    .join(' ');
  return <span className={cls}>{children}</span>;
}

const STATE_TONE: Record<string, Tone> = {
  CONFIRMED: 'ok',
  ACTIVE: 'ok',
  SUCCEEDED: 'ok',
  ALLOW: 'ok',
  APPROVED: 'ok',
  AWAITING_APPROVAL: 'warn',
  REQUIRE_APPROVAL: 'warn',
  PENDING: 'warn',
  PENDING_APPROVAL: 'warn',
  PROPOSED: 'warn',
  SUBMITTING: 'warn',
  SUBMITTED: 'warn',
  UNKNOWN: 'warn',
  FROZEN: 'warn',
  OPEN: 'warn',
  DENIED: 'bad',
  DENY: 'bad',
  BLOCKED: 'bad',
  REJECTED: 'bad',
  EXPIRED: 'bad',
  FAILED: 'bad',
  INCIDENT: 'bad',
  REVOKED: 'bad',
};
export const toneOf = (state: string): Tone => STATE_TONE[state] ?? 'neutral';

export function StateBadge({ state }: { state: string }) {
  return <Badge tone={toneOf(state)}>{humanize(state)}</Badge>;
}

const LADDER: Record<string, { reached: number; tone?: 'bad' | 'warn' }> = {
  PROPOSED: { reached: 1, tone: 'warn' },
  AWAITING_APPROVAL: { reached: 1, tone: 'warn' },
  APPROVED: { reached: 2 },
  SUBMITTING: { reached: 3, tone: 'warn' },
  SUBMITTED: { reached: 3, tone: 'warn' },
  UNKNOWN: { reached: 3, tone: 'warn' },
  CONFIRMED: { reached: 4 },
  DENIED: { reached: 1, tone: 'bad' },
  REJECTED: { reached: 1, tone: 'bad' },
  EXPIRED: { reached: 1, tone: 'bad' },
  FAILED: { reached: 3, tone: 'bad' },
  INCIDENT: { reached: 3, tone: 'bad' },
};

/** Four steps from proposed to confirmed; the colour of the last lit step says how it went. */
export function StateLadder({ state }: { state: string }) {
  const { reached, tone } = LADDER[state] ?? { reached: 0 };
  return (
    <div className="ladder" role="img" aria-label={`${humanize(state)}: step ${reached} of 4`}>
      {[1, 2, 3, 4].map((step) => (
        <i
          key={step}
          data-on={step < reached ? 'ok' : step === reached ? (tone ?? 'ok') : undefined}
        />
      ))}
    </div>
  );
}

export function MoneyAmount({
  minor,
  currency,
  className = '',
}: {
  minor: string | bigint | null | undefined;
  currency: string | null | undefined;
  className?: string;
}) {
  return <span className={`num ${className}`}>{formatMoney(minor, currency)}</span>;
}

/** An id that can be copied with a click. */
export function IdChip({ id, short = true }: { id: string; short?: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="idchip"
      title="Copy"
      onClick={(event) => {
        event.stopPropagation();
        void navigator.clipboard?.writeText(id).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        });
      }}
    >
      {copied ? 'copied' : short ? shortId(id) : id}
    </button>
  );
}

/** Marks anything that is simulated: the fake PayPal, the scripted model, the offline catalog. */
export function SimBadge({ children = 'sim' }: { children?: ReactNode }) {
  return <span className="sim">{children}</span>;
}

export function Panel({
  title,
  action,
  children,
  flush = false,
}: {
  title?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  flush?: boolean;
}) {
  return (
    <section className="panel">
      {title !== undefined && (
        <header className="panel-head">
          <h2 className="panel-title">{title}</h2>
          {action}
        </header>
      )}
      <div className={flush ? undefined : 'panel-body'}>{children}</div>
    </section>
  );
}

export function Stat({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: ReactNode;
}) {
  return (
    <div className="panel stat">
      <span className="stat-label">{label}</span>
      <span className="stat-value">{children}</span>
      {hint !== undefined && <span className="hint">{hint}</span>}
    </div>
  );
}

export function EmptyState({
  title,
  children,
  action,
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <span className="empty-title">{title}</span>
      {children !== undefined && <span className="muted">{children}</span>}
      {action}
    </div>
  );
}

export function Skeleton({ width = '100%' }: { width?: string }) {
  return <span className="skeleton" style={{ width }} aria-hidden="true" />;
}

export function TableSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <output className="stack" style={{ padding: 14 }} aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={`row-${i + 1}`} width={`${88 - i * 9}%`} />
      ))}
    </output>
  );
}

export function ErrorNote({ error, retry }: { error: unknown; retry?: () => void }) {
  const text =
    error instanceof Error
      ? ((error as { readable?: string }).readable ?? error.message)
      : 'Something went wrong.';
  return (
    <div className="empty" role="alert">
      <span className="empty-title">That didn’t load</span>
      <span className="muted">{text}</span>
      {retry !== undefined && (
        <button type="button" className="btn btn-sm" onClick={retry}>
          Try again
        </button>
      )}
    </div>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: ReactNode;
  children: (id: string) => ReactNode;
}) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children(id)}
      {hint !== undefined && <span className="hint">{hint}</span>}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------
// Overlays
// ---------------------------------------------------------------------------------------------------

function useEscape(onClose: () => void) {
  useEffect(() => {
    const handler = (event: KeyboardEvent) => event.key === 'Escape' && onClose();
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);
}

export function Drawer({
  title,
  onClose,
  children,
}: {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
}) {
  useEscape(onClose);
  return (
    <>
      <button
        type="button"
        className="scrim"
        aria-label="Close"
        onClick={onClose}
        style={{ border: 0 }}
      />
      <aside className="drawer" role="dialog" aria-modal="true" aria-label="Details">
        <header className="drawer-head">
          <h2 className="panel-title">{title}</h2>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={onClose}
            aria-label="Close"
          >
            <Icon name="close" />
          </button>
        </header>
        <div className="drawer-body">{children}</div>
      </aside>
    </>
  );
}

export function Dialog({
  title,
  onClose,
  children,
  footer,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer: ReactNode;
}) {
  useEscape(onClose);
  return (
    <>
      <button
        type="button"
        className="scrim"
        aria-label="Close"
        onClick={onClose}
        style={{ border: 0 }}
      />
      <div className="dialog" role="dialog" aria-modal="true" aria-label={title}>
        <header className="panel-head">
          <h2 className="panel-title">{title}</h2>
        </header>
        <div className="dialog-body">{children}</div>
        <footer className="dialog-foot">{footer}</footer>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------------------------------
// Toasts
// ---------------------------------------------------------------------------------------------------

interface ToastItem {
  id: number;
  tone: 'ok' | 'bad';
  text: string;
}
const ToastContext = createContext<(tone: 'ok' | 'bad', text: string) => void>(() => undefined);
export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const push = useCallback((tone: 'ok' | 'bad', text: string) => {
    const id = Date.now() + Math.random();
    setItems((current) => [...current, { id, tone, text }]);
    setTimeout(() => setItems((current) => current.filter((t) => t.id !== id)), 4500);
  }, []);
  const value = useMemo(() => push, [push]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toasts" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className="toast" data-tone={t.tone} role="status">
            {t.text}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

// ---------------------------------------------------------------------------------------------------
// Error boundary
// ---------------------------------------------------------------------------------------------------

export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  override state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  override componentDidCatch(_error: Error, _info: ErrorInfo) {
    // Nothing to send anywhere yet; the message is shown below.
  }
  override render() {
    if (this.state.error === null) return this.props.children;
    return (
      <div className="content">
        <ErrorNote error={this.state.error} retry={() => this.setState({ error: null })} />
      </div>
    );
  }
}
