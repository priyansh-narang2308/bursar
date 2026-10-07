/*
 * The virtual camera. The recorder noted where each thing worth looking at sat on screen, when, and how close to
 * frame it; this turns those notes into a camera position for every frame. Pure, so it can be tested.
 *
 * The world is the 1920x1080 recording. A view says which world point sits at the anchor on screen, and how much the
 * world is scaled. Wide shows the whole screen floating in a frame; medium and close fill the screen and push in.
 */

export const W = 1920;
export const H = 1080;
/** Captions sit at the bottom, so a framed thing is centred in the space above them. */
export const SAFE_H = 930;
export const WIDE_SCALE = 0.86;

export type Size = 'wide' | 'medium' | 'close';
export interface Box {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}
export interface Shot {
  readonly beat: string;
  readonly name: string;
  readonly atMs: number;
  readonly size: Size;
  readonly spot: boolean;
  readonly box?: Box;
  /** When the subject moved or went away; its spotlight ends there. */
  readonly untilMs?: number;
}
export interface View {
  readonly cx: number;
  readonly cy: number;
  readonly scale: number;
  /** Where on screen (y) the view's centre sits. */
  readonly ay: number;
}
export interface Key {
  readonly atMs: number;
  readonly view: View;
  readonly moveMs: number;
  readonly spot?: Box;
  readonly spotUntil?: number;
  readonly name: string;
}

export const WIDE: View = { cx: W / 2, cy: H / 2, scale: WIDE_SCALE, ay: H / 2 - 8 };

const PAD: Record<Exclude<Size, 'wide'>, number> = { medium: 90, close: 44 };
const LIMIT: Record<Exclude<Size, 'wide'>, readonly [number, number]> = {
  medium: [1.05, 1.55],
  close: [1.25, 2.05],
};
const TALLEST: Record<Exclude<Size, 'wide'>, number> = { medium: 640, close: 420 };
/** The least time between two camera moves, so each one lands before the next starts. */
const GAP_MS = 900;
/** How much the camera keeps pushing in while it holds, over eight seconds. */
const DRIFT = 0.03;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Whether a box is mostly on screen; a target that scrolled away is no use to frame. */
export function onScreen(box: Box): boolean {
  const visibleW = Math.min(box.x + box.w, W) - Math.max(box.x, 0);
  const visibleH = Math.min(box.y + box.h, H) - Math.max(box.y, 0);
  return box.w > 4 && box.h > 4 && visibleW > box.w * 0.6 && visibleH > Math.min(box.h, H) * 0.5;
}

/** The view that frames a box at a size, kept inside the recording so its edge never shows when pushed in. */
export function frame(box: Box, size: Exclude<Size, 'wide'>): View {
  const pad = PAD[size];
  const top = Math.max(0, box.y - pad);
  const height = Math.min(Math.min(box.y + box.h, H) + pad - top, TALLEST[size]);
  const left = Math.max(0, box.x - pad);
  const width = Math.min(box.x + box.w, W) + pad - left;
  const [lo, hi] = LIMIT[size];
  const scale = clamp(Math.min((W * 0.94) / width, (SAFE_H * 0.94) / height), lo, hi);
  const ay = SAFE_H / 2;
  const halfW = W / 2 / scale;
  const cx = clamp(left + width / 2, halfW, W - halfW);
  const cy = clamp(top + height / 2, ay / scale, H - (H - ay) / scale);
  return { cx, cy, scale, ay };
}

/** Turns the recorder's shots into camera keys: framed, spaced out, and skipping what cannot be framed. */
export function keys(shots: readonly Shot[], skipBeats: readonly string[] = []): Key[] {
  const out: Key[] = [];
  const noted: number[] = [];
  const sorted = [...shots]
    .filter((s) => !skipBeats.includes(s.beat))
    .sort((a, b) => a.atMs - b.atMs);
  for (const shot of sorted) {
    let view: View;
    if (shot.size === 'wide' || shot.box === undefined) view = WIDE;
    else if (onScreen(shot.box)) view = frame(shot.box, shot.size);
    else continue;
    // Two notes at the same moment (a click that also names its target) are one shot: the later one wins.
    const same = out.length > 0 && shot.atMs - (noted.at(-1) ?? 0) < 80;
    if (same) {
      out.pop();
      noted.pop();
    }
    const previous = out.at(-1);
    const atMs = previous === undefined ? shot.atMs : Math.max(shot.atMs, previous.atMs + GAP_MS);
    // A big change of scale or a long way to travel takes a little longer, as a camera operator would.
    const travel =
      previous === undefined
        ? 0
        : Math.abs(Math.log(view.scale / previous.view.scale)) +
          Math.hypot(view.cx - previous.view.cx, view.cy - previous.view.cy) / 900;
    const moveMs = Math.round(clamp(750 + travel * 420, 750, 1250));
    const key: Key = {
      atMs,
      view,
      moveMs,
      name: shot.name,
      ...(shot.spot && shot.box !== undefined ? { spot: shot.box } : {}),
      ...(shot.untilMs !== undefined ? { spotUntil: shot.untilMs } : {}),
    };
    out.push(key);
    noted.push(shot.atMs);
  }
  return out;
}

/**
 * The camera's easing, cubic-bezier(0.55, 0, 0.1, 1): it leaves gently, commits, and lands with a long, soft settle,
 * the way a person on a fluid head moves a camera. No overshoot.
 */
export function ease(p: number): number {
  const x = clamp(p, 0, 1);
  const [x1, y1, x2, y2] = [0.55, 0, 0.1, 1];
  const curve = (u: number, a: number, b: number) =>
    3 * a * u * (1 - u) ** 2 + 3 * b * u ** 2 * (1 - u) + u ** 3;
  // Solve for the curve parameter whose x is p, by bisection: plenty precise, and always stable.
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    if (curve(mid, x1, x2) < x) lo = mid;
    else hi = mid;
  }
  return curve((lo + hi) / 2, y1, y2);
}

const mix = (a: View, b: View, p: number): View => ({
  cx: a.cx + (b.cx - a.cx) * p,
  cy: a.cy + (b.cy - a.cy) * p,
  ay: a.ay + (b.ay - a.ay) * p,
  scale: Math.exp(Math.log(a.scale) + (Math.log(b.scale) - Math.log(a.scale)) * p),
});

const drift = (view: View, heldMs: number): View => ({
  ...view,
  scale: view.scale * (1 + DRIFT * Math.min(1, Math.max(0, heldMs) / 8000)),
});

/** Where the camera is at a moment: moving between keys, or holding with a slow push-in. */
export function viewAt(list: readonly Key[], ms: number): View {
  let from = WIDE;
  for (let i = 0; i < list.length; i++) {
    const key = list[i] as Key;
    if (ms < key.atMs) return from;
    const next = list[i + 1];
    const settled = drift(key.view, ms - key.atMs - key.moveMs);
    const moving = mix(from, key.view, ease((ms - key.atMs) / key.moveMs));
    const here = ms - key.atMs < key.moveMs ? moving : settled;
    if (next === undefined || ms < next.atMs) return here;
    // The next move starts from exactly where this one is, so nothing ever jumps.
    const at = next.atMs - key.atMs;
    from =
      at < key.moveMs
        ? mix(from, key.view, ease(at / key.moveMs))
        : drift(key.view, at - key.moveMs);
  }
  return from;
}

/** How fast the picture is moving, in screen pixels a frame, for a touch of motion blur. */
export function speedAt(list: readonly Key[], ms: number, frameMs = 1000 / 30): number {
  const a = viewAt(list, ms - frameMs);
  const b = viewAt(list, ms);
  const pan = Math.hypot((b.cx - a.cx) * b.scale, (b.cy - a.cy) * b.scale);
  const zoom = Math.abs(Math.log(b.scale / a.scale)) * W;
  return pan + zoom;
}

/** The thing to keep lit while the rest dims, and how far it has faded in or out. */
export function spotAt(list: readonly Key[], ms: number): { box: Box; opacity: number } | null {
  for (let i = list.length - 1; i >= 0; i--) {
    const key = list[i] as Key;
    if (key.atMs > ms) continue;
    if (key.spot === undefined) return null;
    const next = list[i + 1];
    const rise = clamp((ms - key.atMs - key.moveMs * 0.55) / 350, 0, 1);
    const fall = Math.min(
      next === undefined ? 1 : clamp((next.atMs - ms) / 250, 0, 1),
      key.spotUntil === undefined ? 1 : clamp((key.spotUntil - ms) / 200, 0, 1),
    );
    const opacity = Math.min(rise, fall);
    return opacity > 0 ? { box: key.spot, opacity } : null;
  }
  return null;
}

/** Where a world box lands on screen under a view. */
export function project(box: Box, view: View): Box {
  return {
    x: W / 2 + (box.x - view.cx) * view.scale,
    y: view.ay + (box.y - view.cy) * view.scale,
    w: box.w * view.scale,
    h: box.h * view.scale,
  };
}
