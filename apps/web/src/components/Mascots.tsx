import { useEffect, useRef } from 'react';

/*
 * Three plush characters beside the landing hero, drawn by Things by Rothenhall (MIT) on three.js r128 (MIT). Both
 * are served from our own origin (`public/vendor/things/`), loaded only after the page has painted so the landing
 * stays light, and skipped where WebGL is missing. The engine honours reduced motion. Notices: THIRD_PARTY_NOTICES.md.
 */

interface Avatar {
  setState(state: string): void;
  poke(): void;
  destroy(): void;
}
interface ThingsKit {
  mount(el: HTMLElement, preset: string, opts?: Record<string, unknown>): Avatar;
}
declare global {
  interface Window {
    Things?: ThingsKit;
  }
}

const CAST = [
  {
    preset: 'dew',
    state: 'thinking',
    label: 'Dew, thinking',
    className: 'lp-mascot lp-mascot-back',
  },
  { preset: 'mint', state: 'waving', label: 'Mint, waving', className: 'lp-mascot lp-mascot-lead' },
  {
    preset: 'cosmo',
    state: 'excited',
    label: 'Cosmo, excited',
    className: 'lp-mascot lp-mascot-side',
  },
] as const;

let loading: Promise<ThingsKit | null> | undefined;

function script(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const el = document.createElement('script');
    el.src = src;
    el.async = false;
    el.onload = () => resolve();
    el.onerror = () => reject(new Error(`Could not load ${src}`));
    document.head.appendChild(el);
  });
}

function loadThings(): Promise<ThingsKit | null> {
  loading ??= script('/vendor/things/three.min.js')
    .then(() => script('/vendor/things/things.umd.js'))
    .then(() => window.Things ?? null)
    .catch(() => null);
  return loading;
}

function webgl(): boolean {
  try {
    return !!document.createElement('canvas').getContext('webgl');
  } catch {
    return false;
  }
}

export function Mascots() {
  const slots = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    if (!webgl()) return;
    let avatars: Avatar[] = [];
    let cancelled = false;
    const start = () =>
      void loadThings().then((kit) => {
        if (cancelled || kit === null) return;
        avatars = CAST.flatMap((c, i) => {
          const el = slots.current[i];
          if (!el) return [];
          return [kit.mount(el, c.preset, { state: c.state, quality: 'medium', distance: 6.2 })];
        });
      });
    const idle = window.requestIdleCallback ?? ((f: () => void) => window.setTimeout(f, 600));
    const handle = idle(start);
    return () => {
      cancelled = true;
      if (typeof handle === 'number' && !window.requestIdleCallback) window.clearTimeout(handle);
      for (const a of avatars) a.destroy();
    };
  }, []);

  return (
    <div className="lp-mascots" aria-hidden="true">
      {CAST.map((c, i) => (
        <div
          key={c.preset}
          className={c.className}
          title={c.label}
          ref={(el) => {
            slots.current[i] = el;
          }}
        />
      ))}
    </div>
  );
}
