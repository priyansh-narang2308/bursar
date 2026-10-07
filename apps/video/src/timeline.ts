/*
 * Where each voice, caption and fade goes, worked out from the take's beat times and the real length of each audio
 * file. Pure, so it can be tested without a browser.
 */

export interface BeatTime {
  readonly id: string;
  readonly atMs: number;
  readonly endMs: number;
}
export interface Narration {
  readonly id: string;
  readonly text: string;
}

export interface AudioClip {
  readonly id: string;
  readonly startMs: number;
  readonly durationMs: number;
}
export interface Cue {
  readonly startMs: number;
  readonly endMs: number;
  readonly text: string;
}
export interface Plan {
  readonly durationMs: number;
  readonly audio: readonly AudioClip[];
  readonly cues: readonly Cue[];
  /** Beats whose speech runs past the start of the next beat, which would talk over it. */
  readonly overruns: readonly string[];
}

/** The voice starts a moment after its beat does, so the viewer sees the screen change first. */
export const VOICE_DELAY_MS = 400;
/** A little air after the last beat, and a fade out. */
export const TAIL_MS = 900;

export const framesFor = (ms: number, fps: number) => Math.round((ms / 1000) * fps);

const words = (text: string) => text.trim().split(/\s+/).filter(Boolean).length;

/** Splits narration into sentences and gives each a share of the speech time, by its length in words. */
export function cuesFor(text: string, startMs: number, durationMs: number): Cue[] {
  const sentences = text.match(/[^.!?]+[.!?]+/g)?.map((s) => s.trim()) ?? [text.trim()];
  const total = sentences.reduce((sum, s) => sum + words(s), 0);
  let cursor = startMs;
  return sentences.map((sentence) => {
    const length = Math.round((words(sentence) / total) * durationMs);
    const cue = { startMs: cursor, endMs: cursor + length, text: sentence };
    cursor += length;
    return cue;
  });
}

/** When each sentence starts and ends within its beat's audio, from the narrator. */
export type Spans = Readonly<Record<string, readonly (readonly [number, number])[]>>;

/** Sentences, split where the voice breathes, exactly as the narrator splits them. */
export const sentencesOf = (text: string) =>
  text
    .trim()
    .split(/(?<=[.!?])\s+/)
    .filter(Boolean);

export function plan(input: {
  readonly beats: readonly BeatTime[];
  readonly narration: readonly Narration[];
  readonly durationsMs: Readonly<Record<string, number>>;
  readonly spans?: Spans;
}): Plan {
  const audio: AudioClip[] = [];
  const cues: Cue[] = [];
  const overruns: string[] = [];
  const sorted = [...input.beats].sort((a, b) => a.atMs - b.atMs);
  for (const [i, beat] of sorted.entries()) {
    const line = input.narration.find((n) => n.id === beat.id);
    const durationMs = input.durationsMs[beat.id];
    if (line === undefined || durationMs === undefined) continue;
    const startMs = beat.atMs + VOICE_DELAY_MS;
    audio.push({ id: beat.id, startMs, durationMs });
    const timed = input.spans?.[beat.id];
    const sentences = sentencesOf(line.text);
    if (timed !== undefined && timed.length === sentences.length)
      sentences.forEach((text, n) => {
        const [a, b] = timed[n] as readonly [number, number];
        cues.push({ startMs: startMs + a, endMs: startMs + b, text });
      });
    else cues.push(...cuesFor(line.text, startMs, durationMs));
    const next = sorted[i + 1];
    if (next !== undefined && startMs + durationMs > next.atMs) overruns.push(beat.id);
  }
  const last = sorted.at(-1);
  return { durationMs: (last?.endMs ?? 0) + TAIL_MS, audio, cues, overruns };
}

/** When the narrator says a word (the first containing `word`) in a sentence of a beat, in video milliseconds. */
export function wordMs(
  beat: BeatTime,
  text: string,
  spans: Spans,
  sentence: number,
  word?: string,
): number {
  const span = spans[beat.id]?.[sentence];
  if (span === undefined) return beat.atMs + VOICE_DELAY_MS;
  const words = (sentencesOf(text)[sentence] ?? '').split(/\s+/);
  const at = word === undefined ? -1 : words.findIndex((w) => w.toLowerCase().includes(word));
  const into = at < 0 ? 0 : ((span[1] - span[0]) * at) / words.length;
  return beat.atMs + VOICE_DELAY_MS + span[0] + into;
}

/**
 * The music's level at a moment: it sits low under the voice and lifts a little in the gaps, easing between the two
 * so the ducking is felt rather than heard.
 */
export function musicLevel(
  ms: number,
  voice: readonly AudioClip[],
  { full = 0.5, under = 0.17, attackMs = 300, releaseMs = 700 } = {},
): number {
  let duck = 0;
  for (const clip of voice) {
    const start = clip.startMs - attackMs;
    const end = clip.startMs + clip.durationMs;
    let d = 0;
    if (ms >= clip.startMs && ms <= end) d = 1;
    else if (ms >= start && ms < clip.startMs) d = (ms - start) / attackMs;
    else if (ms > end && ms <= end + releaseMs) d = 1 - (ms - end) / releaseMs;
    duck = Math.max(duck, d);
  }
  const smooth = duck * duck * (3 - 2 * duck);
  return full + (under - full) * smooth;
}
