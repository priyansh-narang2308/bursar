import { describe, expect, it } from 'vitest';
import {
  ease,
  frame,
  H,
  keys,
  onScreen,
  project,
  SAFE_H,
  type Shot,
  speedAt,
  spotAt,
  viewAt,
  W,
  WIDE,
} from '../src/camera';

const shot = (atMs: number, extra: Partial<Shot> = {}): Shot => ({
  beat: 'b',
  name: `s${atMs}`,
  atMs,
  size: 'close',
  spot: true,
  box: { x: 800, y: 400, w: 300, h: 60 },
  ...extra,
});

describe('ease', () => {
  it('starts at rest, ends at rest, and only ever moves forward', () => {
    expect(ease(0)).toBeCloseTo(0, 5);
    expect(ease(1)).toBeCloseTo(1, 5);
    expect(ease(-1)).toBeCloseTo(0, 5);
    let last = 0;
    for (let p = 0; p <= 1; p += 0.02) {
      const v = ease(p);
      expect(v).toBeGreaterThanOrEqual(last - 1e-9);
      expect(v).toBeLessThanOrEqual(1 + 1e-9);
      last = v;
    }
  });
});

describe('frame', () => {
  it('centres a box in the space above the captions, pushed in', () => {
    const box = { x: 800, y: 400, w: 300, h: 60 };
    const view = frame(box, 'close');
    const on = project(box, view);
    expect(view.scale).toBeGreaterThan(1.2);
    expect(on.x + on.w / 2).toBeCloseTo(W / 2, 0);
    expect(on.y + on.h / 2).toBeCloseTo(SAFE_H / 2, 0);
  });

  it('never shows past the edge of the recording when pushed in', () => {
    const view = frame({ x: 0, y: 1000, w: 120, h: 40 }, 'close');
    const corner = project({ x: 0, y: 0, w: W, h: H }, view);
    expect(corner.x).toBeLessThanOrEqual(0.001);
    expect(corner.x + corner.w).toBeGreaterThanOrEqual(W - 0.001);
    expect(corner.y + corner.h).toBeGreaterThanOrEqual(H - 0.001);
  });

  it('frames the top of something taller than the screen', () => {
    const view = frame({ x: 1400, y: 300, w: 520, h: 2600 }, 'medium');
    expect(view.scale).toBeGreaterThanOrEqual(1.05);
    expect(view.cy).toBeLessThan(800);
  });
});

describe('keys', () => {
  it('skips what scrolled away and the designed scenes, and spaces moves out', () => {
    const list = keys(
      [
        shot(0, { beat: 'title' }),
        shot(1000),
        shot(1200, { size: 'wide' }),
        shot(1300, { box: { x: 10, y: 3000, w: 100, h: 50 } }),
      ],
      ['title'],
    );
    expect(list.map((k) => k.atMs)).toEqual([1000, 1900]);
    expect(list[1]?.view).toEqual(WIDE);
    expect(onScreen({ x: 10, y: 3000, w: 100, h: 50 })).toBe(false);
  });

  it('lets a later note at the same moment replace the earlier one', () => {
    const list = keys([shot(1000), shot(1000, { name: 'later', size: 'medium' })]);
    expect(list).toHaveLength(1);
    expect(list[0]?.name).toBe('later');
  });
});

describe('viewAt', () => {
  const list = keys([shot(1000), shot(4000, { size: 'wide' }), shot(4300, { size: 'medium' })]);

  it('holds wide before the first move and arrives where it was sent', () => {
    expect(viewAt(list, 0)).toEqual(WIDE);
    const there = viewAt(list, 1000 + (list[0]?.moveMs ?? 0));
    expect(there.scale).toBeCloseTo(list[0]?.view.scale ?? 0, 5);
  });

  it('never jumps, even when a move starts before the last has landed', () => {
    for (let ms = 0; ms < 8000; ms += 10) {
      const a = viewAt(list, ms);
      const b = viewAt(list, ms + 10);
      expect(Math.abs(b.cx - a.cx)).toBeLessThan(40);
      expect(Math.abs(Math.log(b.scale / a.scale))).toBeLessThan(0.05);
    }
  });

  it('keeps pushing in slowly while it holds, and reports motion while moving', () => {
    const settled = 1000 + (list[0]?.moveMs ?? 0);
    expect(viewAt(list, settled + 2000).scale).toBeGreaterThan(viewAt(list, settled).scale);
    expect(speedAt(list, 1300)).toBeGreaterThan(speedAt(list, settled + 1500));
  });
});

describe('spotAt', () => {
  it('lights the subject once the camera arrives, and lets go before the next move', () => {
    const list = keys([shot(1000), shot(5000, { size: 'wide', spot: false })]);
    expect(spotAt(list, 500)).toBeNull();
    expect(spotAt(list, 1100)).toBeNull();
    expect(spotAt(list, 3000)?.opacity).toBe(1);
    expect(spotAt(list, 4900)?.opacity ?? 0).toBeLessThan(1);
    expect(spotAt(list, 5200)).toBeNull();
  });

  it('lets go as soon as the subject moved or went away', () => {
    const list = keys([shot(1000, { untilMs: 2600 }), shot(5000, { size: 'wide', spot: false })]);
    expect(spotAt(list, 2200)?.opacity).toBe(1);
    expect(spotAt(list, 2500)?.opacity ?? 0).toBeLessThan(1);
    expect(spotAt(list, 2700)).toBeNull();
  });
});
