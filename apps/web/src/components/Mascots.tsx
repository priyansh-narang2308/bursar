import { useEffect, useRef } from 'react';

/*
 * Plush characters through the public pages, drawn by Things by Rothenhall (MIT) on three.js r128 (MIT). Both are
 * served from our own origin (`public/vendor/things/`) and load only once the page is idle. Each character is its
 * own WebGL scene and a browser allows only a handful at once, so a character starts when it scrolls near the
 * screen and is torn down when it leaves. Skipped where WebGL is missing; the engine honours reduced motion.
 * Notices: THIRD_PARTY_NOTICES.md.
 */

interface Avatar {
  setConfig(partial: Record<string, unknown>): void;
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

/** Awake moods only: no sleepy state, no closed-eye looks. */
type Mood = 'idle' | 'thinking' | 'talking' | 'excited' | 'waving';
export interface Character {
  readonly preset: string;
  readonly mood: Mood;
  readonly look?: Readonly<Record<string, string>>;
}

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

function whenIdle(): Promise<void> {
  return new Promise((resolve) => {
    if (window.requestIdleCallback) window.requestIdleCallback(() => resolve());
    else window.setTimeout(resolve, 600);
  });
}

function loadThings(): Promise<ThingsKit | null> {
  loading ??= whenIdle()
    .then(() => script('/vendor/things/three.min.js'))
    .then(() => script('/vendor/things/things.umd.js'))
    .then(() => window.Things ?? null)
    .catch(() => null);
  return loading;
}

let canDraw: boolean | undefined;
function webgl(): boolean {
  if (canDraw === undefined) {
    try {
      canDraw = !!document.createElement('canvas').getContext('webgl');
    } catch {
      canDraw = false;
    }
  }
  return canDraw;
}

/** One character, alive only while it is on or near the screen. */
export function Plush({ character, className }: { character: Character; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (el === null || !webgl() || !('IntersectionObserver' in window)) return;
    let avatar: Avatar | null = null;
    let near = false;
    let alive = true;
    const start = () =>
      void loadThings().then((kit) => {
        if (!alive || !near || avatar !== null || kit === null) return;
        avatar = kit.mount(el, character.preset, {
          state: character.mood,
          quality: 'medium',
          distance: 6.2,
        });
        avatar.setConfig({ eyes: 'safety', ...character.look });
      });
    const watch = new IntersectionObserver(
      ([entry]) => {
        near = entry?.isIntersecting ?? false;
        if (near) start();
        else if (avatar !== null) {
          avatar.destroy();
          avatar = null;
        }
      },
      { rootMargin: '240px 0px' },
    );
    watch.observe(el);
    return () => {
      alive = false;
      watch.disconnect();
      avatar?.destroy();
    };
  }, [character]);

  return <div ref={ref} className={`lp-plush ${className ?? ''}`} aria-hidden="true" />;
}

/** The cast, each one different: colour, outfit and mood. */
export const CAST = {
  heroBack: { preset: 'plum', mood: 'excited', look: { glasses: 'none' } },
  heroLead: { preset: 'mallow', mood: 'waving' },
  heroSide: { preset: 'dew', mood: 'talking' },
  problem: { preset: 'poppy', mood: 'thinking' },
  how: { preset: 'cosmo', mood: 'talking' },
  flow: { preset: 'truffle', mood: 'waving' },
  proof: { preset: 'tango', mood: 'excited' },
  honest: { preset: 'pebble', mood: 'idle', look: { eyes: 'oval' } },
  tryIt: { preset: 'mint', mood: 'waving', look: { eyes: 'googly' } },
  builtOn: {
    preset: 'plum',
    mood: 'excited',
    look: {
      color: '#3D7BFF',
      accent: '#3D7BFF',
      glasses: 'none',
      hat: 'party',
      hatColor: '#FFD23F',
    },
  },
  ctaLeft: {
    preset: 'mallow',
    mood: 'waving',
    look: { color: '#FFD23F', accent: '#FFD23F', hat: 'crown', hatColor: '#FF7A59' },
  },
  ctaRight: {
    preset: 'dew',
    mood: 'excited',
    look: { color: '#B388FF', accent: '#B388FF', glasses: 'none' },
  },
  foot1: {
    preset: 'poppy',
    mood: 'idle',
    look: { color: '#FF9F1C', accent: '#FF9F1C', hat: 'beanie', hatColor: '#3D7BFF' },
  },
  foot2: {
    preset: 'truffle',
    mood: 'waving',
    look: { color: '#F7F3EA', accent: '#F7F3EA', hat: 'party', hatColor: '#FF5D8F' },
  },
  foot3: { preset: 'cosmo', mood: 'talking', look: { color: '#FF5D8F', accent: '#FF5D8F' } },
  foot4: { preset: 'pebble', mood: 'excited', look: { color: '#4D6BFF', accent: '#4D6BFF' } },
} satisfies Record<string, Character>;

/** The three beside the hero. */
export function Mascots() {
  return (
    <div className="lp-mascots">
      <Plush character={CAST.heroBack} className="lp-mascot lp-mascot-back" />
      <Plush character={CAST.heroLead} className="lp-mascot lp-mascot-lead" />
      <Plush character={CAST.heroSide} className="lp-mascot lp-mascot-side" />
    </div>
  );
}

/** The row in the footer. */
export function FooterCast() {
  return (
    <div className="lp-foot-cast">
      <Plush character={CAST.foot1} className="lp-plush-foot" />
      <Plush character={CAST.foot2} className="lp-plush-foot" />
      <Plush character={CAST.foot3} className="lp-plush-foot" />
      <Plush character={CAST.foot4} className="lp-plush-foot" />
    </div>
  );
}
