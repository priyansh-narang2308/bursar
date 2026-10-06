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

export function plan(input: {
  readonly beats: readonly BeatTime[];
  readonly narration: readonly Narration[];
  readonly durationsMs: Readonly<Record<string, number>>;
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
    cues.push(...cuesFor(line.text, startMs, durationMs));
    const next = sorted[i + 1];
    if (next !== undefined && startMs + durationMs > next.atMs) overruns.push(beat.id);
  }
  const last = sorted.at(-1);
  return { durationMs: (last?.endMs ?? 0) + TAIL_MS, audio, cues, overruns };
}

/**
 * Where a caption's opacity rises and falls, as frame numbers that always increase (Remotion refuses a range that
 * does not), however short the caption is. A caption too short to fade is simply shown.
 */
export function fadeRange(
  frames: number,
  fade = 6,
): readonly [number, number, number, number] | null {
  const edge = Math.min(fade, Math.floor((frames - 1) / 2));
  return edge < 1 ? null : [0, edge, frames - edge, frames];
}
