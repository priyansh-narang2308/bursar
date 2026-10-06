import { describe, expect, it } from 'vitest';
import { cuesFor, fadeRange, framesFor, plan, TAIL_MS, VOICE_DELAY_MS } from '../src/timeline';

describe('cuesFor', () => {
  it('gives each sentence a share of the speech by its words, covering it exactly once', () => {
    const cues = cuesFor('One two. Three four five six. Seven.', 1000, 7000);
    expect(cues.map((c) => c.text)).toEqual(['One two.', 'Three four five six.', 'Seven.']);
    expect(cues[0]?.startMs).toBe(1000);
    for (let i = 1; i < cues.length; i += 1) expect(cues[i]?.startMs).toBe(cues[i - 1]?.endMs);
    expect(cues.at(-1)?.endMs).toBeGreaterThanOrEqual(7990);
    expect(cues.at(-1)?.endMs).toBeLessThanOrEqual(8010);
    expect(cues[1]?.endMs ?? 0).toBeGreaterThan((cues[0]?.endMs ?? 0) + 2000); // the longer sentence got longer
  });

  it('keeps text with no sentence ending as a single cue', () => {
    expect(cuesFor('No full stop here', 0, 3000)).toEqual([
      { startMs: 0, endMs: 3000, text: 'No full stop here' },
    ]);
  });
});

describe('plan', () => {
  const beats = [
    { id: 'b', atMs: 10_000, endMs: 20_000 },
    { id: 'a', atMs: 0, endMs: 10_000 },
  ];
  const narration = [
    { id: 'a', text: 'First beat. It has two sentences.' },
    { id: 'b', text: 'Second beat.' },
  ];

  it('starts each voice a moment after its beat, in order, and ends a little after the last beat', () => {
    const result = plan({ beats, narration, durationsMs: { a: 6000, b: 3000 } });
    expect(result.audio).toEqual([
      { id: 'a', startMs: VOICE_DELAY_MS, durationMs: 6000 },
      { id: 'b', startMs: 10_000 + VOICE_DELAY_MS, durationMs: 3000 },
    ]);
    expect(result.durationMs).toBe(20_000 + TAIL_MS);
    expect(result.cues).toHaveLength(3);
    expect(result.overruns).toEqual([]);
  });

  it('names a beat whose speech runs into the next beat', () => {
    expect(plan({ beats, narration, durationsMs: { a: 11_000, b: 3000 } }).overruns).toEqual(['a']);
  });

  it('skips a beat that has no narration or no audio, and copes with nothing at all', () => {
    expect(
      plan({ beats, narration: [narration[1] ?? { id: 'b', text: '' }], durationsMs: { b: 1000 } })
        .audio,
    ).toHaveLength(1);
    expect(plan({ beats, narration, durationsMs: { a: 1000 } }).audio).toHaveLength(1);
    expect(plan({ beats: [], narration: [], durationsMs: {} })).toEqual({
      durationMs: TAIL_MS,
      audio: [],
      cues: [],
      overruns: [],
    });
  });
});

describe('framesFor', () => {
  it('rounds milliseconds to the nearest frame', () => {
    expect(framesFor(1000, 30)).toBe(30);
    expect(framesFor(1016, 30)).toBe(30);
    expect(framesFor(1034, 30)).toBe(31);
  });
});

describe('fadeRange', () => {
  it('always increases, however short the caption, and skips the fade when there is no room', () => {
    for (let frames = 1; frames < 40; frames += 1) {
      const range = fadeRange(frames);
      if (range === null) continue;
      expect(range[0]).toBeLessThan(range[1]);
      expect(range[1]).toBeLessThan(range[2]);
      expect(range[2]).toBeLessThan(range[3]);
    }
    expect(fadeRange(60)).toEqual([0, 6, 54, 60]);
    expect(fadeRange(12)).toEqual([0, 5, 7, 12]);
    expect(fadeRange(2)).toBeNull();
  });
});
