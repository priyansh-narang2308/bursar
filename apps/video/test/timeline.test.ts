import { describe, expect, it } from 'vitest';
import {
  cuesFor,
  framesFor,
  musicLevel,
  plan,
  sentencesOf,
  TAIL_MS,
  VOICE_DELAY_MS,
  wordMs,
} from '../src/timeline';

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

describe('sentence timing', () => {
  const beats = [{ id: 'a', atMs: 1000, endMs: 9000 }];
  const narration = [{ id: 'a', text: 'A cap of $10,000.00, a limit. Then it holds.' }];
  const spans = {
    a: [
      [0, 2000],
      [2300, 4000],
    ] as [number, number][],
  };

  it('splits where the voice breathes, not inside an amount', () => {
    expect(sentencesOf(narration[0]?.text ?? '')).toEqual([
      'A cap of $10,000.00, a limit.',
      'Then it holds.',
    ]);
  });

  it("times captions to the narrator's real sentences when it has them", () => {
    const { cues } = plan({ beats, narration, durationsMs: { a: 4000 }, spans });
    const at = 1000 + VOICE_DELAY_MS;
    expect(cues).toEqual([
      { startMs: at, endMs: at + 2000, text: 'A cap of $10,000.00, a limit.' },
      { startMs: at + 2300, endMs: at + 4000, text: 'Then it holds.' },
    ]);
  });

  it('finds when a word is said, and falls back to the sentence start', () => {
    const at = 1000 + VOICE_DELAY_MS;
    expect(wordMs(beats[0] as never, narration[0]?.text ?? '', spans, 1)).toBe(at + 2300);
    expect(wordMs(beats[0] as never, narration[0]?.text ?? '', spans, 1, 'holds')).toBeCloseTo(
      at + 2300 + (1700 * 2) / 3,
    );
    expect(wordMs(beats[0] as never, '', {}, 0)).toBe(at);
  });
});

describe('musicLevel', () => {
  const voice = [{ id: 'a', startMs: 1000, durationMs: 2000 }];

  it('sits low under the voice and full in the gaps, easing between', () => {
    expect(musicLevel(0, voice)).toBe(0.5);
    expect(musicLevel(2000, voice)).toBeCloseTo(0.17);
    expect(musicLevel(5000, voice)).toBe(0.5);
    const before = musicLevel(850, voice);
    expect(before).toBeLessThan(0.5);
    expect(before).toBeGreaterThan(0.17);
    const after = musicLevel(3350, voice);
    expect(after).toBeLessThan(0.5);
    expect(after).toBeGreaterThan(0.17);
  });
});
